// Transcription task queue - processes import/retranscribe jobs sequentially
// Prevents Whisper/Parakeet engine contention by ensuring only one task runs at a time

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Runtime};
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;

/// Type of transcription task
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    Import,
    Retranscribe,
}

/// Status of a queued task
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Pending,
    Active,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// A transcription task in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionTask {
    pub task_id: String,
    pub task_type: TaskType,
    pub title: String,
    pub status: TaskStatus,
    // Import-specific fields
    pub source_path: Option<String>,
    // Retranscribe-specific fields
    pub meeting_id: Option<String>,
    pub meeting_folder_path: Option<String>,
    // Shared fields
    pub language: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
}

/// Progress event emitted by the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueProgressEvent {
    pub task_id: String,
    pub task_type: TaskType,
    pub title: String,
    pub stage: String,
    pub progress_percentage: u32,
    pub message: String,
    pub is_paused: bool,
    pub queue_position: Option<usize>,
    pub queue_total: Option<usize>,
}

/// Completion event emitted by the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueCompleteEvent {
    pub task_id: String,
    pub task_type: TaskType,
    pub title: String,
    pub meeting_id: String,
    pub segments_count: usize,
    pub duration_seconds: f64,
}

/// Error event emitted by the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueErrorEvent {
    pub task_id: String,
    pub task_type: TaskType,
    pub title: String,
    pub error: String,
}

/// Queue status for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatus {
    pub tasks: Vec<QueueTaskInfo>,
    pub active_task_id: Option<String>,
    pub pending_count: usize,
}

/// Info about a single task in the queue status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueTaskInfo {
    pub task_id: String,
    pub task_type: TaskType,
    pub title: String,
    pub status: TaskStatus,
}

/// Per-task control flags (cancel + pause)
struct TaskFlags {
    cancelled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

static TASK_FLAGS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, TaskFlags>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Global notify used to wake paused tasks when resume is called
static RESUME_NOTIFY: std::sync::LazyLock<Arc<Notify>> =
    std::sync::LazyLock::new(|| Arc::new(Notify::new()));

/// Get or create a cancellation flag for a task
fn get_cancel_flag(task_id: &str) -> Arc<AtomicBool> {
    let mut flags = TASK_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
    let entry = flags.entry(task_id.to_string()).or_insert_with(|| TaskFlags {
        cancelled: Arc::new(AtomicBool::new(false)),
        paused: Arc::new(AtomicBool::new(false)),
    });
    entry.cancelled.clone()
}

/// Get or create a pause flag for a task
fn get_pause_flag(task_id: &str) -> Arc<AtomicBool> {
    let mut flags = TASK_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
    let entry = flags.entry(task_id.to_string()).or_insert_with(|| TaskFlags {
        cancelled: Arc::new(AtomicBool::new(false)),
        paused: Arc::new(AtomicBool::new(false)),
    });
    entry.paused.clone()
}

/// Remove flags for a completed/failed task
fn remove_cancel_flag(task_id: &str) {
    let mut flags = TASK_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
    flags.remove(task_id);
}

/// Check if a task is cancelled
pub fn is_task_cancelled(task_id: &str) -> bool {
    let flags = TASK_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
    flags
        .get(task_id)
        .map(|f| f.cancelled.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// Check if a task is paused
pub fn is_task_paused(task_id: &str) -> bool {
    let flags = TASK_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
    flags
        .get(task_id)
        .map(|f| f.paused.load(Ordering::SeqCst))
        .unwrap_or(false)
}

/// Wait while the task is paused. Returns immediately if not paused.
/// Returns false if the task was cancelled while paused.
pub async fn wait_if_paused(task_id: &str) -> bool {
    loop {
        if !is_task_paused(task_id) {
            return true; // not paused, continue
        }
        if is_task_cancelled(task_id) {
            return false; // cancelled while paused
        }
        // Wait for a resume signal, then re-check
        RESUME_NOTIFY.notified().await;
    }
}

/// ID of the currently active task (if any). Used by import/retranscription
/// to check pause state between segments.
static ACTIVE_TASK_ID: std::sync::LazyLock<std::sync::Mutex<Option<String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

fn set_active_task_id(task_id: Option<&str>) {
    let mut id = ACTIVE_TASK_ID.lock().unwrap_or_else(|e| e.into_inner());
    *id = task_id.map(|s| s.to_string());
}

/// Check if the currently active task is paused, and if so, block until resumed.
/// This is meant to be called from import/retranscription segment loops.
/// Returns false if cancelled while paused.
pub async fn check_pause() -> bool {
    let task_id = {
        let id = ACTIVE_TASK_ID.lock().unwrap_or_else(|e| e.into_inner());
        id.clone()
    };
    match task_id {
        Some(id) => wait_if_paused(&id).await,
        None => true,
    }
}

/// The transcription queue manager
pub struct TranscriptionQueue {
    tasks: Arc<Mutex<VecDeque<TranscriptionTask>>>,
    active_task: Arc<Mutex<Option<TranscriptionTask>>>,
    notify: Arc<Notify>,
}

impl TranscriptionQueue {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(VecDeque::new())),
            active_task: Arc::new(Mutex::new(None)),
            notify: Arc::new(Notify::new()),
        }
    }

    /// Add a task to the queue and return its task_id
    pub async fn enqueue(&self, mut task: TranscriptionTask) -> String {
        if task.task_id.is_empty() {
            task.task_id = format!("task-{}", Uuid::new_v4());
        }
        task.status = TaskStatus::Pending;

        // Create cancellation flag
        let _flag = get_cancel_flag(&task.task_id);

        let task_id = task.task_id.clone();
        {
            let mut queue = self.tasks.lock().await;
            queue.push_back(task);
        }

        // Wake the worker
        self.notify.notify_one();

        info!("Enqueued transcription task: {}", task_id);
        task_id
    }

    /// Cancel a task by ID (works for both pending and active tasks)
    pub async fn cancel_task(&self, task_id: &str) -> bool {
        // Set the cancellation flag
        let flag = get_cancel_flag(task_id);
        flag.store(true, Ordering::SeqCst);

        // Check if it's a pending task and remove it
        {
            let mut queue = self.tasks.lock().await;
            if let Some(pos) = queue.iter().position(|t| t.task_id == task_id) {
                queue.remove(pos);
                remove_cancel_flag(task_id);
                info!("Removed pending task from queue: {}", task_id);
                return true;
            }
        }

        // Check if it's the active task
        {
            let active = self.active_task.lock().await;
            if let Some(ref task) = *active {
                if task.task_id == task_id {
                    info!("Cancellation flag set for active task: {}", task_id);
                    return true;
                }
            }
        }

        warn!("Task not found for cancellation: {}", task_id);
        false
    }

    /// Get current queue status
    pub async fn get_status(&self) -> QueueStatus {
        let queue = self.tasks.lock().await;
        let active = self.active_task.lock().await;

        let mut tasks: Vec<QueueTaskInfo> = Vec::new();

        if let Some(ref task) = *active {
            let status = if is_task_paused(&task.task_id) {
                TaskStatus::Paused
            } else {
                TaskStatus::Active
            };
            tasks.push(QueueTaskInfo {
                task_id: task.task_id.clone(),
                task_type: task.task_type.clone(),
                title: task.title.clone(),
                status,
            });
        }

        for task in queue.iter() {
            tasks.push(QueueTaskInfo {
                task_id: task.task_id.clone(),
                task_type: task.task_type.clone(),
                title: task.title.clone(),
                status: TaskStatus::Pending,
            });
        }

        let pending_count = queue.len();
        let active_task_id = active.as_ref().map(|t| t.task_id.clone());

        QueueStatus {
            tasks,
            active_task_id,
            pending_count,
        }
    }

    /// Check if the queue has an active task
    pub async fn has_active_task(&self) -> bool {
        self.active_task.lock().await.is_some()
    }

    /// Start the queue worker loop
    pub fn start_worker<R: Runtime>(self: Arc<Self>, app: AppHandle<R>) {
        let queue = self.clone();
        tauri::async_runtime::spawn(async move {
            info!("Transcription queue worker started");
            loop {
                // Wait for a notification that a task is available
                queue.notify.notified().await;

                // Process all available tasks
                loop {
                    let task = {
                        let mut tasks = queue.tasks.lock().await;
                        tasks.pop_front()
                    };

                    let task = match task {
                        Some(t) => t,
                        None => break, // No more tasks
                    };

                    // Skip cancelled tasks
                    if is_task_cancelled(&task.task_id) {
                        info!("Skipping cancelled task: {}", task.task_id);
                        remove_cancel_flag(&task.task_id);
                        continue;
                    }

                    // Set as active
                    {
                        let mut active = queue.active_task.lock().await;
                        *active = Some(task.clone());
                    }
                    set_active_task_id(Some(&task.task_id));

                    // Emit queue status update
                    emit_queue_status(&app, &queue).await;

                    // Execute the task
                    info!("Processing task: {} ({})", task.task_id, task.title);
                    match task.task_type {
                        TaskType::Import => {
                            process_import_task(&app, &task).await;
                        }
                        TaskType::Retranscribe => {
                            process_retranscribe_task(&app, &task).await;
                        }
                    }

                    // Clear active task
                    set_active_task_id(None);
                    {
                        let mut active = queue.active_task.lock().await;
                        *active = None;
                    }

                    // Clean up cancel flag
                    remove_cancel_flag(&task.task_id);

                    // Emit updated queue status
                    emit_queue_status(&app, &queue).await;
                }
            }
        });
    }
}

/// Emit queue status to the frontend
async fn emit_queue_status<R: Runtime>(app: &AppHandle<R>, queue: &TranscriptionQueue) {
    let status = queue.get_status().await;
    let _ = app.emit("transcription-queue-status", &status);
}

/// Process an import task
async fn process_import_task<R: Runtime>(app: &AppHandle<R>, task: &TranscriptionTask) {
    let source_path = match &task.source_path {
        Some(p) => p.clone(),
        None => {
            emit_error(app, task, "Missing source path for import task");
            return;
        }
    };

    // Set up cancellation bridge: the import module checks IMPORT_CANCELLED,
    // so we need to bridge our per-task flag to it
    use super::import::IMPORT_CANCELLED;
    IMPORT_CANCELLED.store(false, Ordering::SeqCst);

    // Set up a cancellation watcher
    let task_id = task.task_id.clone();
    let cancel_flag = get_cancel_flag(&task_id);
    let cancel_watcher = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
            if cancel_flag.load(Ordering::SeqCst) {
                IMPORT_CANCELLED.store(true, Ordering::SeqCst);
                break;
            }
        }
    });

    // Bridge import-progress events to queue events
    let app_for_bridge = app.clone();
    let task_clone = task.clone();
    let progress_bridge = app.listen("import-progress", move |event| {
        if let Ok(progress) = serde_json::from_str::<super::import::ImportProgress>(event.payload()) {
            let _ = app_for_bridge.emit(
                "transcription-queue-progress",
                QueueProgressEvent {
                    task_id: task_clone.task_id.clone(),
                    task_type: task_clone.task_type.clone(),
                    title: task_clone.title.clone(),
                    stage: progress.stage,
                    progress_percentage: progress.progress_percentage,
                    message: progress.message,
                    is_paused: is_task_paused(&task_clone.task_id),
                    queue_position: None,
                    queue_total: None,
                },
            );
        }
    });

    // Run the import
    let result = super::import::run_import_for_queue(
        app.clone(),
        source_path,
        task.title.clone(),
        task.language.clone(),
        task.model.clone(),
        task.provider.clone(),
    )
    .await;

    // Clean up
    cancel_watcher.abort();
    app.unlisten(progress_bridge);

    match result {
        Ok(import_result) => {
            info!(
                "Import task {} completed: {} segments",
                task.task_id, import_result.segments_count
            );

            let _ = app.emit(
                "transcription-queue-complete",
                QueueCompleteEvent {
                    task_id: task.task_id.clone(),
                    task_type: task.task_type.clone(),
                    title: task.title.clone(),
                    meeting_id: import_result.meeting_id.clone(),
                    segments_count: import_result.segments_count,
                    duration_seconds: import_result.duration_seconds,
                },
            );

            // Also emit the original import-complete event for sidebar refresh
            let _ = app.emit(
                "import-complete",
                serde_json::json!({
                    "meeting_id": import_result.meeting_id,
                    "title": import_result.title,
                    "segments_count": import_result.segments_count,
                    "duration_seconds": import_result.duration_seconds
                }),
            );
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("cancelled") {
                info!("Import task {} was cancelled", task.task_id);
                let _ = app.emit(
                    "transcription-queue-error",
                    QueueErrorEvent {
                        task_id: task.task_id.clone(),
                        task_type: task.task_type.clone(),
                        title: task.title.clone(),
                        error: "Import cancelled".to_string(),
                    },
                );
            } else {
                error!("Import task {} failed: {}", task.task_id, error_msg);
                emit_error(app, task, &error_msg);
            }
        }
    }
}

/// Process a retranscribe task
async fn process_retranscribe_task<R: Runtime>(app: &AppHandle<R>, task: &TranscriptionTask) {
    let meeting_id = match &task.meeting_id {
        Some(id) => id.clone(),
        None => {
            emit_error(app, task, "Missing meeting_id for retranscribe task");
            return;
        }
    };

    let meeting_folder_path = match &task.meeting_folder_path {
        Some(p) => p.clone(),
        None => {
            emit_error(app, task, "Missing meeting_folder_path for retranscribe task");
            return;
        }
    };

    // Bridge cancellation flag
    use super::retranscription::RETRANSCRIPTION_CANCELLED;
    RETRANSCRIPTION_CANCELLED.store(false, Ordering::SeqCst);

    let task_id = task.task_id.clone();
    let cancel_flag = get_cancel_flag(&task_id);
    let cancel_watcher = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
            if cancel_flag.load(Ordering::SeqCst) {
                RETRANSCRIPTION_CANCELLED.store(true, Ordering::SeqCst);
                break;
            }
        }
    });

    // Bridge retranscription-progress events to queue events
    let app_for_bridge = app.clone();
    let task_clone = task.clone();
    let progress_bridge = app.listen("retranscription-progress", move |event| {
        if let Ok(progress) = serde_json::from_str::<super::retranscription::RetranscriptionProgress>(
            event.payload(),
        ) {
            if progress.meeting_id == task_clone.meeting_id.as_deref().unwrap_or("") {
                let _ = app_for_bridge.emit(
                    "transcription-queue-progress",
                    QueueProgressEvent {
                        task_id: task_clone.task_id.clone(),
                        task_type: task_clone.task_type.clone(),
                        title: task_clone.title.clone(),
                        stage: progress.stage,
                        progress_percentage: progress.progress_percentage,
                        message: progress.message,
                        is_paused: is_task_paused(&task_clone.task_id),
                        queue_position: None,
                        queue_total: None,
                    },
                );
            }
        }
    });

    // Run retranscription
    let result = super::retranscription::run_retranscription_for_queue(
        app.clone(),
        meeting_id.clone(),
        meeting_folder_path,
        task.language.clone(),
        task.model.clone(),
        task.provider.clone(),
    )
    .await;

    // Clean up
    cancel_watcher.abort();
    app.unlisten(progress_bridge);

    match result {
        Ok(retranscription_result) => {
            info!(
                "Retranscribe task {} completed: {} segments",
                task.task_id, retranscription_result.segments_count
            );

            let _ = app.emit(
                "transcription-queue-complete",
                QueueCompleteEvent {
                    task_id: task.task_id.clone(),
                    task_type: task.task_type.clone(),
                    title: task.title.clone(),
                    meeting_id: retranscription_result.meeting_id.clone(),
                    segments_count: retranscription_result.segments_count,
                    duration_seconds: retranscription_result.duration_seconds,
                },
            );

            // Also emit the original retranscription-complete event
            let _ = app.emit(
                "retranscription-complete",
                serde_json::json!({
                    "meeting_id": retranscription_result.meeting_id,
                    "segments_count": retranscription_result.segments_count,
                    "duration_seconds": retranscription_result.duration_seconds,
                    "language": retranscription_result.language
                }),
            );
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("cancelled") {
                info!("Retranscribe task {} was cancelled", task.task_id);
                let _ = app.emit(
                    "transcription-queue-error",
                    QueueErrorEvent {
                        task_id: task.task_id.clone(),
                        task_type: task.task_type.clone(),
                        title: task.title.clone(),
                        error: "Retranscription cancelled".to_string(),
                    },
                );
            } else {
                error!("Retranscribe task {} failed: {}", task.task_id, error_msg);
                emit_error(app, task, &error_msg);
            }
        }
    }
}

/// Emit an error event for a task
fn emit_error<R: Runtime>(app: &AppHandle<R>, task: &TranscriptionTask, error: &str) {
    let _ = app.emit(
        "transcription-queue-error",
        QueueErrorEvent {
            task_id: task.task_id.clone(),
            task_type: task.task_type.clone(),
            title: task.title.clone(),
            error: error.to_string(),
        },
    );
}

// ============================================================================
// Global queue instance
// ============================================================================

static TRANSCRIPTION_QUEUE: std::sync::LazyLock<Arc<TranscriptionQueue>> =
    std::sync::LazyLock::new(|| Arc::new(TranscriptionQueue::new()));

/// Get the global transcription queue
pub fn get_queue() -> Arc<TranscriptionQueue> {
    TRANSCRIPTION_QUEUE.clone()
}

/// Initialize the queue worker (call once on app startup)
pub fn init_queue_worker<R: Runtime>(app: &AppHandle<R>) {
    let queue = get_queue();
    queue.start_worker(app.clone());
    info!("Transcription queue worker initialized");
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Get the current queue status
#[tauri::command]
pub async fn get_transcription_queue_status() -> QueueStatus {
    get_queue().get_status().await
}

/// Cancel a transcription task by ID
#[tauri::command]
pub async fn cancel_transcription_task(task_id: String) -> Result<bool, String> {
    Ok(get_queue().cancel_task(&task_id).await)
}

/// Pause an active transcription task (pauses between segments)
#[tauri::command]
pub async fn pause_transcription_task(task_id: String) -> Result<bool, String> {
    let flag = get_pause_flag(&task_id);
    flag.store(true, Ordering::SeqCst);
    info!("Pause requested for task: {}", task_id);
    Ok(true)
}

/// Resume a paused transcription task
#[tauri::command]
pub async fn resume_transcription_task(task_id: String) -> Result<bool, String> {
    let flag = get_pause_flag(&task_id);
    flag.store(false, Ordering::SeqCst);
    RESUME_NOTIFY.notify_waiters();
    info!("Resume requested for task: {}", task_id);
    Ok(true)
}

/// Check if the queue has an active task (used to determine if live transcription should be disabled)
#[tauri::command]
pub async fn is_transcription_queue_active() -> bool {
    get_queue().has_active_task().await
}
