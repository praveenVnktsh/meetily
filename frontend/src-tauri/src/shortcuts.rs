use std::str::FromStr;
use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

pub const DEFAULT_RECORDING: &str = "CmdOrCtrl+Shift+KeyR";
pub const DEFAULT_WINDOW: &str = "CmdOrCtrl+Shift+KeyM";

pub struct GlobalShortcuts {
    pub recording: String,
    pub window: String,
}

fn store_string<R: Runtime>(app: &AppHandle<R>, key: &str, default: &str) -> String {
    app.store("store.json")
        .ok()
        .and_then(|store| store.get(key))
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| default.to_string())
}

/// The configured shortcuts (falling back to defaults).
pub fn current<R: Runtime>(app: &AppHandle<R>) -> GlobalShortcuts {
    GlobalShortcuts {
        recording: store_string(app, "shortcutRecording", DEFAULT_RECORDING),
        window: store_string(app, "shortcutWindow", DEFAULT_WINDOW),
    }
}

/// An empty string disables a shortcut; anything else must parse.
fn validate(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Ok(());
    }
    Shortcut::from_str(value)
        .map(|_| ())
        .map_err(|error| format!("'{value}' is not a valid shortcut: {error}"))
}

/// (Re)register the shortcuts from settings.
///
/// Failures (for example when another app already owns the combination) are
/// logged rather than fatal so the rest of the app keeps working.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let config = current(app);

    if !config.recording.trim().is_empty() {
        match shortcuts.on_shortcut(config.recording.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                crate::tray::toggle_recording_handler(app);
            }
        }) {
            Ok(()) => log::info!("Registered recording shortcut: {}", config.recording),
            Err(error) => log::warn!(
                "Failed to register recording shortcut '{}': {}",
                config.recording,
                error
            ),
        }
    }

    if !config.window.trim().is_empty() {
        match shortcuts.on_shortcut(config.window.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                crate::tray::toggle_main_window(app);
            }
        }) {
            Ok(()) => log::info!("Registered window shortcut: {}", config.window),
            Err(error) => log::warn!(
                "Failed to register window shortcut '{}': {}",
                config.window,
                error
            ),
        }
    }
}

#[tauri::command]
pub fn get_global_shortcuts<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    let config = current(&app);
    serde_json::json!({ "recording": config.recording, "window": config.window })
}

#[tauri::command]
pub fn set_global_shortcuts<R: Runtime>(
    app: AppHandle<R>,
    recording: String,
    window: String,
) -> Result<(), String> {
    let recording = recording.trim().to_string();
    let window = window.trim().to_string();
    validate(&recording)?;
    validate(&window)?;

    if let Ok(store) = app.store("store.json") {
        store.set("shortcutRecording", serde_json::Value::String(recording));
        store.set("shortcutWindow", serde_json::Value::String(window));
        let _ = store.save();
    }

    register(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate, DEFAULT_RECORDING, DEFAULT_WINDOW};
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_shortcuts_parse() {
        assert!(Shortcut::from_str(DEFAULT_RECORDING).is_ok());
        assert!(Shortcut::from_str(DEFAULT_WINDOW).is_ok());
        assert_ne!(DEFAULT_RECORDING, DEFAULT_WINDOW);
    }

    #[test]
    fn validation_allows_empty_and_rejects_garbage() {
        assert!(validate("").is_ok());
        assert!(validate("CmdOrCtrl+Shift+KeyR").is_ok());
        assert!(validate("Ctrl+Alt+Space").is_ok());
        assert!(validate("NotAKey").is_err());
    }
}
