use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::FromRow;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use url::Url;
use uuid::Uuid;

use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;

const STORE_FILE: &str = "webhook-settings.json";
const STORE_KEY: &str = "transcription_complete";
const EVENT_TYPE: &str = "transcription.completed";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WebhookConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub signing_secret: String,
}

#[derive(Debug, Clone, Serialize)]
struct WebhookPayload {
    id: String,
    event_type: &'static str,
    created_at: String,
    meeting: MeetingPayload,
    result: ResultPayload,
}

#[derive(Debug, Clone, Serialize)]
struct MeetingPayload {
    id: String,
    title: String,
    started_at: String,
    calendar_event_id: Option<String>,
    external_ledger_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ResultPayload {
    status: &'static str,
    transcript_segments: i64,
    duration_seconds: f64,
    meetily_path: String,
}

#[derive(Debug, FromRow)]
struct PendingDelivery {
    event_id: String,
    payload: String,
    attempt_count: i64,
}

fn load_config<R: Runtime>(app: &AppHandle<R>) -> Result<WebhookConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|error| format!("Failed to open webhook settings: {error}"))?;

    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|error| format!("Failed to read webhook settings: {error}")),
        None => Ok(WebhookConfig::default()),
    }
}

fn validate_config(config: &WebhookConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }

    let endpoint = Url::parse(config.endpoint.trim())
        .map_err(|_| "Webhook endpoint must be a valid URL".to_string())?;
    let is_localhost = endpoint.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
    });
    if endpoint.scheme() != "https" && !(endpoint.scheme() == "http" && is_localhost) {
        return Err("Webhook endpoint must use HTTPS (HTTP is allowed for localhost)".to_string());
    }
    if config.signing_secret.trim().len() < 16 {
        return Err("Webhook signing secret must contain at least 16 characters".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_webhook_config<R: Runtime>(app: AppHandle<R>) -> Result<WebhookConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub async fn set_webhook_config<R: Runtime>(
    app: AppHandle<R>,
    config: WebhookConfig,
) -> Result<(), String> {
    validate_config(&config)?;
    let store = app
        .store(STORE_FILE)
        .map_err(|error| format!("Failed to open webhook settings: {error}"))?;
    store.set(
        STORE_KEY,
        serde_json::to_value(config)
            .map_err(|error| format!("Failed to serialize webhook settings: {error}"))?,
    );
    store
        .save()
        .map_err(|error| format!("Failed to save webhook settings: {error}"))
}

fn sign_payload(secret: &str, payload: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|_| "Invalid webhook signing secret".to_string())?;
    mac.update(payload.as_bytes());
    Ok(format!(
        "sha256={}",
        hex::encode(mac.finalize().into_bytes())
    ))
}

async fn post_payload(
    config: &WebhookConfig,
    event_id: &str,
    event_type: &str,
    payload: &str,
) -> Result<(), String> {
    validate_config(config)?;
    let signature = sign_payload(&config.signing_secret, payload)?;
    let response = reqwest::Client::new()
        .post(config.endpoint.trim())
        .header("content-type", "application/json")
        .header("x-meetily-event-id", event_id)
        .header("x-meetily-event-type", event_type)
        .header("x-meetily-signature", signature)
        .body(payload.to_owned())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("Webhook request failed: {error}"))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Webhook endpoint returned HTTP {}",
            response.status()
        ))
    }
}

#[tauri::command]
pub async fn test_webhook<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let config = load_config(&app)?;
    let event_id = format!("evt_{}", Uuid::new_v4());
    let payload = serde_json::json!({
        "id": event_id,
        "event_type": "transcription.completed.test",
        "created_at": Utc::now().to_rfc3339(),
        "meeting": {
            "id": "test-meeting",
            "title": "Meetily webhook test",
            "started_at": Utc::now().to_rfc3339(),
            "calendar_event_id": null,
            "external_ledger_id": null
        },
        "result": {
            "status": "complete",
            "transcript_segments": 1,
            "duration_seconds": 1.0,
            "meetily_path": "/meeting-details?id=test-meeting"
        }
    })
    .to_string();
    post_payload(&config, &event_id, "transcription.completed.test", &payload).await
}

pub async fn enqueue_transcription_complete<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
) -> Result<bool, String> {
    let config = load_config(app)?;
    if !config.enabled {
        return Ok(false);
    }
    validate_config(&config)?;

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "Database is not initialized".to_string())?;
    let pool = state.db_manager.pool();
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|error| format!("Failed to load meeting for webhook: {error}"))?
        .ok_or_else(|| format!("Meeting {meeting_id} was not found"))?;
    let (segment_count, duration_seconds): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(MAX(audio_end_time), 0.0) FROM transcripts WHERE meeting_id = ?",
    )
    .bind(meeting_id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Failed to load transcript metadata for webhook: {error}"))?;

    let event_id = format!("evt_{}", Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let payload = serde_json::to_string(&WebhookPayload {
        id: event_id.clone(),
        event_type: EVENT_TYPE,
        created_at: now.clone(),
        meeting: MeetingPayload {
            id: meeting.id,
            title: meeting.title,
            started_at: meeting.created_at.0.to_rfc3339(),
            calendar_event_id: None,
            external_ledger_id: None,
        },
        result: ResultPayload {
            status: "complete",
            transcript_segments: segment_count,
            duration_seconds,
            meetily_path: format!("/meeting-details?id={meeting_id}"),
        },
    })
    .map_err(|error| format!("Failed to serialize webhook payload: {error}"))?;

    let result = sqlx::query(
        "INSERT OR IGNORE INTO webhook_deliveries
         (event_id, event_type, meeting_id, payload, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&event_id)
    .bind(EVENT_TYPE)
    .bind(meeting_id)
    .bind(payload)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to enqueue webhook: {error}"))?;

    Ok(result.rows_affected() == 1)
}

async fn deliver_pending<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let config = load_config(app)?;
    if !config.enabled || validate_config(&config).is_err() {
        return Ok(());
    }
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };
    let pool = state.db_manager.pool();
    let deliveries = sqlx::query_as::<_, PendingDelivery>(
        "SELECT event_id, payload, attempt_count
         FROM webhook_deliveries
         WHERE delivered_at IS NULL AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT 10",
    )
    .bind(Utc::now().to_rfc3339())
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load webhook outbox: {error}"))?;

    for delivery in deliveries {
        match post_payload(&config, &delivery.event_id, EVENT_TYPE, &delivery.payload).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE webhook_deliveries SET delivered_at = ?, last_error = NULL WHERE event_id = ?",
                )
                .bind(Utc::now().to_rfc3339())
                .bind(&delivery.event_id)
                .execute(pool)
                .await
                .map_err(|error| format!("Failed to mark webhook delivered: {error}"))?;
                log::info!("Delivered transcription webhook {}", delivery.event_id);
            }
            Err(error) => {
                let next_attempt = delivery.attempt_count + 1;
                let delay_seconds = (15_i64 * 2_i64.pow(next_attempt.min(8) as u32)).min(3600);
                sqlx::query(
                    "UPDATE webhook_deliveries
                     SET attempt_count = ?, next_attempt_at = ?, last_error = ?
                     WHERE event_id = ?",
                )
                .bind(next_attempt)
                .bind((Utc::now() + Duration::seconds(delay_seconds)).to_rfc3339())
                .bind(&error)
                .bind(&delivery.event_id)
                .execute(pool)
                .await
                .map_err(|db_error| format!("Failed to update webhook retry: {db_error}"))?;
                log::warn!("Webhook {} failed: {}", delivery.event_id, error);
            }
        }
    }
    Ok(())
}

pub fn init_worker<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Err(error) = deliver_pending(&app).await {
                log::warn!("Webhook delivery pass failed: {}", error);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_payload_with_stable_sha256_hmac() {
        assert_eq!(
            sign_payload("0123456789abcdef", "{\"ok\":true}").unwrap(),
            "sha256=8a782523af5169f2186640bc66718bf0be9396ae14b3d22bc0b0d8a04af83e8d"
        );
    }

    #[test]
    fn requires_https_except_for_local_development() {
        let config = |endpoint: &str| WebhookConfig {
            enabled: true,
            endpoint: endpoint.to_string(),
            signing_secret: "0123456789abcdef".to_string(),
        };
        assert!(validate_config(&config("https://hooks.example.com/meetily")).is_ok());
        assert!(validate_config(&config("http://localhost:8787/webhook")).is_ok());
        assert!(validate_config(&config("http://hooks.example.com/meetily")).is_err());
    }
}
