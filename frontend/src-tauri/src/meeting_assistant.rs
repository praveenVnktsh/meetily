use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TranscriptEdit {
    id: String,
    text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistantOutput {
    reply: String,
    #[serde(default)]
    notes_markdown: Option<String>,
    #[serde(default)]
    transcript_edits: Vec<TranscriptEdit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAssistantResponse {
    pub message: MeetingChatMessage,
    pub notes_markdown: Option<String>,
    pub transcript_edits_applied: usize,
}

fn parse_assistant_output(content: &str) -> Result<AssistantOutput, String> {
    let start = content
        .find('{')
        .ok_or("The model did not return a structured response")?;
    let end = content
        .rfind('}')
        .ok_or("The model returned incomplete structured data")?;
    serde_json::from_str(&content[start..=end])
        .map_err(|error| format!("Could not understand the assistant response: {error}"))
}

async fn save_chat_message(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    role: &str,
    content: &str,
) -> Result<MeetingChatMessage, String> {
    let message = MeetingChatMessage {
        id: Uuid::new_v4().to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    sqlx::query(
        "INSERT INTO meeting_chat_messages (id, meeting_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&message.id)
    .bind(meeting_id)
    .bind(role)
    .bind(content)
    .bind(&message.created_at)
    .execute(pool)
    .await
    .map_err(|error| format!("Could not save meeting chat: {error}"))?;
    Ok(message)
}

#[tauri::command]
pub async fn get_meeting_chat(
    meeting_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<MeetingChatMessage>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, role, content, created_at FROM meeting_chat_messages WHERE meeting_id = ? ORDER BY created_at ASC",
    )
    .bind(meeting_id)
    .fetch_all(state.db_manager.pool())
    .await
    .map_err(|error| format!("Could not load meeting chat: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|(id, role, content, created_at)| MeetingChatMessage {
            id,
            role,
            content,
            created_at,
        })
        .collect())
}

#[tauri::command]
pub async fn chat_with_meeting<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<MeetingAssistantResponse, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a message first".to_string());
    }
    let pool = state.db_manager.pool();
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|error| format!("Could not load AI settings: {error}"))?
        .ok_or("Choose an AI model in Settings first")?;
    let provider = LLMProvider::from_str(&config.provider)?;
    let standard_api_key = if matches!(
        provider,
        LLMProvider::Ollama | LLMProvider::BuiltInAI | LLMProvider::CustomOpenAI
    ) {
        String::new()
    } else {
        SettingsRepository::get_api_key(pool, &config.provider)
            .await
            .map_err(|error| format!("Could not load the AI provider key: {error}"))?
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Add an API key for {} in Settings", config.provider))?
    };
    let custom = if provider == LLMProvider::CustomOpenAI {
        SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|error| format!("Could not load custom AI settings: {error}"))?
    } else {
        None
    };
    let api_key = custom
        .as_ref()
        .and_then(|value| value.api_key.clone())
        .unwrap_or(standard_api_key);

    let transcript_rows = sqlx::query_as::<_, (String, String, Option<String>, Option<f64>)>(
        "SELECT id, transcript, speaker, audio_start_time FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC, timestamp ASC",
    )
    .bind(&meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Could not load the transcript: {error}"))?;
    let transcript_json = serde_json::to_value(
        transcript_rows
            .iter()
            .map(|(id, text, speaker, start)| {
                serde_json::json!({
                    "id": id, "speaker": speaker, "startSeconds": start, "text": text,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;
    let raw_notes = sqlx::query_scalar::<_, String>(
        "SELECT notes_markdown FROM meeting_notes WHERE meeting_id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Could not load raw notes: {error}"))?
    .unwrap_or_default();
    let summary_json = sqlx::query_scalar::<_, String>(
        "SELECT result FROM summary_processes WHERE meeting_id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Could not load enhanced notes: {error}"))?
    .unwrap_or_default();
    let history = sqlx::query_as::<_, (String, String)>(
        "SELECT role, content FROM meeting_chat_messages WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 12",
    )
    .bind(&meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Could not load meeting chat history: {error}"))?;

    let context = serde_json::json!({
        "rawNotesMarkdown": raw_notes,
        "enhancedNotes": summary_json,
        "transcriptSegments": transcript_json,
        "recentConversationNewestFirst": history,
        "request": message,
    });
    let system_prompt = r#"You are the meeting workspace assistant. Work from the raw notes, enhanced notes, transcript, and recent conversation supplied by the app. Answer questions, synthesize details, and revise the enhanced notes when the user asks. Only edit transcript text when the user explicitly asks to correct, clean, rename, or rewrite transcript content; never silently alter the factual record. Transcript edits must use exact supplied segment ids. Preserve unsupported facts as unknown. Return only valid JSON with this exact shape: {"reply":"brief helpful response","notesMarkdown":null,"transcriptEdits":[]}. Set notesMarkdown to the complete revised enhanced-notes Markdown only when notes should change. Set transcriptEdits to objects with id and complete replacement text only for segments that should change."#;
    let app_data_dir = app.path().app_data_dir().ok();
    let completion = generate_summary(
        &reqwest::Client::new(),
        &provider,
        custom
            .as_ref()
            .map(|value| value.model.as_str())
            .unwrap_or(&config.model),
        &api_key,
        system_prompt,
        &context.to_string(),
        config.ollama_endpoint.as_deref(),
        custom.as_ref().map(|value| value.endpoint.as_str()),
        custom
            .as_ref()
            .and_then(|value| value.max_tokens)
            .map(|value| value as u32),
        custom.as_ref().and_then(|value| value.temperature),
        custom.as_ref().and_then(|value| value.top_p),
        app_data_dir.as_ref(),
        None,
    )
    .await?;
    let output = parse_assistant_output(&completion.content)?;

    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let mut edits_applied = 0usize;
    for edit in output
        .transcript_edits
        .iter()
        .filter(|edit| !edit.text.trim().is_empty())
    {
        let previous = sqlx::query_scalar::<_, String>(
            "SELECT transcript FROM transcripts WHERE id = ? AND meeting_id = ?",
        )
        .bind(&edit.id)
        .bind(&meeting_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
        let Some(previous) = previous else {
            continue;
        };
        if previous == edit.text {
            continue;
        }
        sqlx::query("INSERT INTO transcript_revisions (id, meeting_id, transcript_id, previous_text, revised_text, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(Uuid::new_v4().to_string()).bind(&meeting_id).bind(&edit.id).bind(&previous)
            .bind(&edit.text).bind(message).bind(Utc::now().to_rfc3339())
            .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
        sqlx::query("UPDATE transcripts SET transcript = ? WHERE id = ? AND meeting_id = ?")
            .bind(&edit.text)
            .bind(&edit.id)
            .bind(&meeting_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        edits_applied += 1;
    }
    if let Some(notes) = output
        .notes_markdown
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let result = serde_json::json!({ "markdown": notes });
        sqlx::query(
            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, result) VALUES (?, 'completed', ?, ?, ?) ON CONFLICT(meeting_id) DO UPDATE SET status = 'completed', result = excluded.result, updated_at = excluded.updated_at, error = NULL",
        )
        .bind(&meeting_id).bind(Utc::now()).bind(Utc::now()).bind(result.to_string())
        .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    // Only commit the conversation once the model response and requested
    // workspace changes have succeeded, avoiding orphaned failed turns.
    save_chat_message(pool, &meeting_id, "user", message).await?;
    let assistant_message =
        save_chat_message(pool, &meeting_id, "assistant", &output.reply).await?;
    Ok(MeetingAssistantResponse {
        message: assistant_message,
        notes_markdown: output.notes_markdown,
        transcript_edits_applied: edits_applied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_from_a_fenced_model_response() {
        let parsed = parse_assistant_output(
            "```json\n{\"reply\":\"Done\",\"notesMarkdown\":null,\"transcriptEdits\":[]}\n```",
        )
        .unwrap();
        assert_eq!(parsed.reply, "Done");
        assert!(parsed.notes_markdown.is_none());
    }
}
