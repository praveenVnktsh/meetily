//! Show the floating "meeting detected" prompt.
//!
//! Driven from Rust (not the main webview) so it appears even when the Minutes
//! window is in the background and macOS has throttled its webview.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime};

/// Set when the user dismisses (or acts on) the prompt for the current call.
static PROMPT_DISMISSED: AtomicBool = AtomicBool::new(false);

/// Dismiss the prompt for the current call (until audio stops).
pub fn dismiss() {
    PROMPT_DISMISSED.store(true, Ordering::SeqCst);
}

/// Allow prompting again (called when system audio stops).
pub fn reset() {
    PROMPT_DISMISSED.store(false, Ordering::SeqCst);
}

/// Tauri command so the webview can dismiss the prompt.
#[tauri::command]
pub fn dismiss_meeting_prompt() {
    dismiss();
}

/// Position and show the `meeting-prompt` window for a detected app.
pub async fn maybe_show<R: Runtime>(app: &AppHandle<R>, app_name: &str) {
    if PROMPT_DISMISSED.load(Ordering::SeqCst) {
        return;
    }

    let enabled = crate::audio::recording_preferences::load_recording_preferences(app)
        .await
        .map(|prefs| prefs.automatic_record_prompt)
        .unwrap_or(true);
    if !enabled || crate::audio::recording_commands::is_recording().await {
        return;
    }

    let Some(window) = app.get_webview_window("meeting-prompt") else {
        log::warn!("Meeting prompt: window 'meeting-prompt' is unavailable");
        return;
    };

    if let Ok(Some(monitor)) = app.primary_monitor() {
        if let Ok(size) = window.outer_size() {
            let margin = (16.0 * monitor.scale_factor()) as i32;
            let x = monitor.position().x + monitor.size().width as i32 - size.width as i32 - margin;
            let y = monitor.position().y + margin;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }

    if let Err(error) = window.show() {
        log::warn!("Meeting prompt: failed to show window: {}", error);
    }
    if let Err(error) = app.emit_to(
        "meeting-prompt",
        "meeting-prompt-show",
        serde_json::json!({ "appName": app_name }),
    ) {
        log::warn!("Meeting prompt: failed to emit show event: {}", error);
    }
    let _ = window.set_focus();
}

/// Start recording from the floating prompt. Runs entirely in Rust so it does
/// not depend on the (possibly throttled) main webview.
#[tauri::command]
pub async fn start_recording_from_prompt<R: Runtime>(app: AppHandle<R>) {
    dismiss();
    if let Some(window) = app.get_webview_window("meeting-prompt") {
        let _ = window.hide();
    }

    crate::tray::focus_main_window(&app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("sessionStorage.setItem('autoStartRecording', 'true')");
        let _ = window.eval("window.location.assign('/')");
    }
}
