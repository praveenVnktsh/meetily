use crate::api::TranscriptSegment;
use crate::audio::common::write_transcripts_json;
use crate::audio::decoder::decode_audio_file;
use crate::audio::retranscription::find_audio_file;
use crate::database::models::Transcript;
use crate::state::AppState;
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use uuid::Uuid;

const ENGINE: &str = "sherpa-onnx-1.13.8";
const SEGMENTATION_MODEL: &str = "pyannote-segmentation-3.0-int8";
const EMBEDDING_MODEL: &str = "nemo-titanet-small";
const SEGMENTATION_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
const EMBEDDING_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiarizationResult {
    pub id: String,
    pub meeting_id: String,
    pub engine: String,
    pub segmentation_model: String,
    pub embedding_model: String,
    pub generated_at: String,
    pub speaker_count: usize,
    pub turns: Vec<SpeakerTurn>,
}

struct ModelPaths {
    segmentation: PathBuf,
    embedding: PathBuf,
}

#[cfg(target_os = "macos")]
async fn download(url: &str, destination: &Path) -> Result<()> {
    if destination.exists() && destination.metadata()?.len() > 0 {
        return Ok(());
    }
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    let bytes = response.bytes().await?;
    let partial = destination.with_extension("part");
    tokio::fs::write(&partial, &bytes).await?;
    tokio::fs::rename(&partial, destination).await?;
    Ok(())
}

#[cfg(target_os = "macos")]
async fn ensure_models<R: Runtime>(app: &AppHandle<R>) -> Result<ModelPaths> {
    let root = app
        .path()
        .app_data_dir()?
        .join("models")
        .join("diarization");
    tokio::fs::create_dir_all(&root).await?;

    let segmentation_dir = root.join("sherpa-onnx-pyannote-segmentation-3-0");
    let segmentation = segmentation_dir.join("model.int8.onnx");
    if !segmentation.exists() {
        let archive_path = root.join("segmentation.tar.bz2");
        let _ = app.emit(
            "diarization-progress",
            serde_json::json!({
                "stage": "downloading_models", "progress_percentage": 5,
                "message": "Downloading local speaker segmentation model..."
            }),
        );
        download(SEGMENTATION_ARCHIVE_URL, &archive_path).await?;
        let root_for_extract = root.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let file = std::fs::File::open(&archive_path)?;
            let decoder = bzip2::read::BzDecoder::new(file);
            let mut archive = tar::Archive::new(decoder);
            archive.unpack(&root_for_extract)?;
            std::fs::remove_file(archive_path)?;
            Ok(())
        })
        .await
        .map_err(|error| anyhow!("Model extraction task failed: {error}"))??;
    }

    let embedding = root.join("nemo_en_titanet_small.onnx");
    if !embedding.exists() {
        let _ = app.emit(
            "diarization-progress",
            serde_json::json!({
                "stage": "downloading_models", "progress_percentage": 10,
                "message": "Downloading local speaker embedding model..."
            }),
        );
        download(EMBEDDING_MODEL_URL, &embedding).await?;
    }

    if !segmentation.exists() || !embedding.exists() {
        return Err(anyhow!("Diarization models are incomplete after download"));
    }
    Ok(ModelPaths {
        segmentation,
        embedding,
    })
}

#[cfg(not(target_os = "macos"))]
async fn ensure_models<R: Runtime>(_app: &AppHandle<R>) -> Result<ModelPaths> {
    Err(anyhow!(
        "Local speaker diarization is currently supported on macOS"
    ))
}

#[cfg(target_os = "macos")]
fn diarize_samples(
    samples: &[f32],
    models: &ModelPaths,
    num_speakers: Option<usize>,
) -> Result<Vec<SpeakerTurn>> {
    use sherpa_onnx::{
        FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
        OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
        SpeakerEmbeddingExtractorConfig,
    };

    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                model: Some(models.segmentation.to_string_lossy().into_owned()),
                window_shift_ratio: 0.1,
            },
            num_threads: 2,
            ..Default::default()
        },
        embedding: SpeakerEmbeddingExtractorConfig {
            model: Some(models.embedding.to_string_lossy().into_owned()),
            num_threads: 2,
            ..Default::default()
        },
        clustering: FastClusteringConfig {
            num_clusters: num_speakers.map(|value| value as i32).unwrap_or(-1),
            threshold: 0.8,
            compute_confidence: true,
        },
        ..Default::default()
    };
    let diarizer = OfflineSpeakerDiarization::create(&config)
        .ok_or_else(|| anyhow!("Failed to initialize the local diarization engine"))?;
    if diarizer.sample_rate() != 16_000 {
        return Err(anyhow!(
            "Diarization model expected {}Hz audio",
            diarizer.sample_rate()
        ));
    }
    let result = diarizer
        .process(samples)
        .ok_or_else(|| anyhow!("Local diarization returned no result"))?;
    Ok(result
        .sort_by_start_time()
        .into_iter()
        .map(|turn| SpeakerTurn {
            start: turn.start as f64,
            end: turn.end as f64,
            speaker: format!("raw_{:02}", turn.speaker),
            confidence: turn.confidence,
        })
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn diarize_samples(
    _samples: &[f32],
    _models: &ModelPaths,
    _num_speakers: Option<usize>,
) -> Result<Vec<SpeakerTurn>> {
    Err(anyhow!(
        "Local speaker diarization is currently supported on macOS"
    ))
}

fn overlap(start_a: f64, end_a: f64, start_b: f64, end_b: f64) -> f64 {
    (end_a.min(end_b) - start_a.max(start_b)).max(0.0)
}

/// Reuse existing speaker IDs when a rerun overlaps previously labeled transcript
/// segments, then allocate deterministic IDs to any newly discovered clusters.
fn stabilize_turn_labels(turns: &mut [SpeakerTurn], transcripts: &[Transcript]) {
    let mut scores: HashMap<(String, String), f64> = HashMap::new();
    for turn in turns.iter() {
        for transcript in transcripts {
            let Some(previous) = transcript
                .speaker
                .as_deref()
                .filter(|value| value.starts_with("speaker_"))
            else {
                continue;
            };
            let (Some(start), Some(end)) = (transcript.audio_start_time, transcript.audio_end_time)
            else {
                continue;
            };
            let amount = overlap(turn.start, turn.end, start, end);
            if amount > 0.0 {
                *scores
                    .entry((turn.speaker.clone(), previous.to_string()))
                    .or_default() += amount;
            }
        }
    }

    let mut candidates: Vec<_> = scores.into_iter().collect();
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut mapping = HashMap::new();
    let mut used_labels = HashSet::new();
    for ((raw, previous), _) in candidates {
        if !mapping.contains_key(&raw) && used_labels.insert(previous.clone()) {
            mapping.insert(raw, previous);
        }
    }

    let mut raw_labels: Vec<String> = turns.iter().map(|turn| turn.speaker.clone()).collect();
    raw_labels.sort();
    raw_labels.dedup();
    let mut next = 0usize;
    for raw in raw_labels {
        if mapping.contains_key(&raw) {
            continue;
        }
        loop {
            let label = format!("speaker_{next:02}");
            next += 1;
            if used_labels.insert(label.clone()) {
                mapping.insert(raw.clone(), label);
                break;
            }
        }
    }
    for turn in turns {
        if let Some(label) = mapping.get(&turn.speaker) {
            turn.speaker.clone_from(label);
        }
    }
}

fn speaker_for_transcript(transcript: &Transcript, turns: &[SpeakerTurn]) -> Option<String> {
    let (start, end) = (transcript.audio_start_time?, transcript.audio_end_time?);
    let overlapping = turns
        .iter()
        .map(|turn| (turn, overlap(start, end, turn.start, turn.end)))
        .filter(|(_, amount)| *amount > 0.0)
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(turn, _)| turn.speaker.clone());
    overlapping.or_else(|| {
        let midpoint = (start + end) / 2.0;
        turns
            .iter()
            .min_by(|left, right| {
                let left_distance = if midpoint < left.start {
                    left.start - midpoint
                } else if midpoint > left.end {
                    midpoint - left.end
                } else {
                    0.0
                };
                let right_distance = if midpoint < right.start {
                    right.start - midpoint
                } else if midpoint > right.end {
                    midpoint - right.end
                } else {
                    0.0
                };
                left_distance.total_cmp(&right_distance)
            })
            .map(|turn| turn.speaker.clone())
    })
}

async fn persist<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    folder: &Path,
    transcripts: &[Transcript],
    result: &DiarizationResult,
) -> Result<()> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow!("App state not available"))?;
    let pool = state.db_manager.pool();
    let mut tx = pool.begin().await?;
    for transcript in transcripts {
        let speaker = speaker_for_transcript(transcript, &result.turns)
            .or_else(|| transcript.speaker.clone());
        sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ? AND meeting_id = ?")
            .bind(speaker)
            .bind(&transcript.id)
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO diarization_runs (id, meeting_id, engine, segmentation_model, embedding_model, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(&result.id)
        .bind(meeting_id)
        .bind(&result.engine)
        .bind(&result.segmentation_model)
        .bind(&result.embedding_model)
        .bind(serde_json::to_string(result)?)
        .bind(&result.generated_at)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let updated: Vec<TranscriptSegment> = transcripts
        .iter()
        .map(|transcript| TranscriptSegment {
            id: transcript.id.clone(),
            text: transcript.transcript.clone(),
            timestamp: transcript.timestamp.clone(),
            speaker: speaker_for_transcript(transcript, &result.turns)
                .or_else(|| transcript.speaker.clone()),
            audio_start_time: transcript.audio_start_time,
            audio_end_time: transcript.audio_end_time,
            duration: transcript.duration,
        })
        .collect();
    write_transcripts_json(folder, &updated)?;
    let temp_path = folder.join(".diarization.json.tmp");
    tokio::fs::write(&temp_path, serde_json::to_vec_pretty(result)?).await?;
    tokio::fs::rename(temp_path, folder.join("diarization.json")).await?;
    Ok(())
}

pub async fn run_for_meeting<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &str,
    num_speakers: Option<usize>,
) -> Result<DiarizationResult> {
    if matches!(num_speakers, Some(0)) {
        return Err(anyhow!("num_speakers must be greater than zero"));
    }
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow!("App state not available"))?;
    let pool = state.db_manager.pool();
    let folder_path: String =
        sqlx::query_scalar::<_, Option<String>>("SELECT folder_path FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await?
            .flatten()
            .ok_or_else(|| anyhow!("Meeting has no recording folder"))?;
    let transcripts: Vec<Transcript> = sqlx::query_as(
        "SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time, timestamp",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await?;
    if transcripts.is_empty() {
        return Err(anyhow!("Meeting has no transcript segments"));
    }
    let folder = PathBuf::from(folder_path);
    let audio_path = find_audio_file(&folder)?;
    let models = ensure_models(app).await?;
    let _ = app.emit(
        "diarization-progress",
        serde_json::json!({
            "meeting_id": meeting_id, "stage": "processing", "progress_percentage": 25,
            "message": "Identifying local speakers..."
        }),
    );
    let samples = tokio::task::spawn_blocking(move || -> Result<Vec<f32>> {
        Ok(decode_audio_file(&audio_path)?.to_whisper_format())
    })
    .await
    .map_err(|error| anyhow!("Audio decode task failed: {error}"))??;
    let mut turns =
        tokio::task::spawn_blocking(move || diarize_samples(&samples, &models, num_speakers))
            .await
            .map_err(|error| anyhow!("Diarization task failed: {error}"))??;
    if turns.is_empty() {
        return Err(anyhow!("No speaker turns were detected"));
    }
    stabilize_turn_labels(&mut turns, &transcripts);
    let speaker_count = turns
        .iter()
        .map(|turn| &turn.speaker)
        .collect::<HashSet<_>>()
        .len();
    let result = DiarizationResult {
        id: format!("diarization-{}", Uuid::new_v4()),
        meeting_id: meeting_id.to_string(),
        engine: ENGINE.to_string(),
        segmentation_model: SEGMENTATION_MODEL.to_string(),
        embedding_model: EMBEDDING_MODEL.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        speaker_count,
        turns,
    };
    persist(app, meeting_id, &folder, &transcripts, &result)
        .await
        .context("Failed to persist diarization output")?;
    let _ = app.emit("diarization-complete", &result);
    Ok(result)
}

#[tauri::command]
pub async fn run_speaker_diarization<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    num_speakers: Option<usize>,
) -> Result<DiarizationResult, String> {
    run_for_meeting(&app, &meeting_id, num_speakers)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(id: &str, start: f64, end: f64, speaker: Option<&str>) -> Transcript {
        Transcript {
            id: id.into(),
            meeting_id: "meeting".into(),
            transcript: id.into(),
            timestamp: "now".into(),
            speaker: speaker.map(str::to_string),
            summary: None,
            action_items: None,
            key_points: None,
            audio_start_time: Some(start),
            audio_end_time: Some(end),
            duration: Some(end - start),
        }
    }

    #[test]
    fn assigns_by_largest_timestamp_overlap() {
        let turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: "speaker_00".into(),
                confidence: 1.0,
            },
            SpeakerTurn {
                start: 2.0,
                end: 6.0,
                speaker: "speaker_01".into(),
                confidence: 1.0,
            },
        ];
        assert_eq!(
            speaker_for_transcript(&transcript("a", 1.5, 4.0, None), &turns),
            Some("speaker_01".into())
        );
    }

    #[test]
    fn rerun_preserves_previous_ids_by_overlap() {
        let transcripts = vec![
            transcript("a", 0.0, 2.0, Some("speaker_03")),
            transcript("b", 2.0, 4.0, Some("speaker_01")),
        ];
        let mut turns = vec![
            SpeakerTurn {
                start: 0.0,
                end: 2.0,
                speaker: "raw_01".into(),
                confidence: 1.0,
            },
            SpeakerTurn {
                start: 2.0,
                end: 4.0,
                speaker: "raw_00".into(),
                confidence: 1.0,
            },
        ];
        stabilize_turn_labels(&mut turns, &transcripts);
        assert_eq!(turns[0].speaker, "speaker_03");
        assert_eq!(turns[1].speaker, "speaker_01");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires downloaded models and MEETILY_DIARIZATION_FIXTURE"]
    fn diarizes_real_multi_speaker_fixture() {
        let fixture = std::env::var("MEETILY_DIARIZATION_FIXTURE")
            .expect("MEETILY_DIARIZATION_FIXTURE must point to a 16 kHz WAV file");
        let segmentation = std::env::var("MEETILY_SEGMENTATION_MODEL")
            .expect("MEETILY_SEGMENTATION_MODEL must point to model.int8.onnx");
        let embedding = std::env::var("MEETILY_EMBEDDING_MODEL")
            .expect("MEETILY_EMBEDDING_MODEL must point to an embedding ONNX model");
        let audio = decode_audio_file(Path::new(&fixture)).expect("fixture should decode");
        let turns = diarize_samples(
            &audio.to_whisper_format(),
            &ModelPaths {
                segmentation: segmentation.into(),
                embedding: embedding.into(),
            },
            Some(4),
        )
        .expect("fixture should diarize");

        let speakers = turns
            .iter()
            .map(|turn| turn.speaker.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(speakers.len(), 4);
        assert!(turns
            .iter()
            .all(|turn| turn.start >= 0.0 && turn.end > turn.start));
    }
}
