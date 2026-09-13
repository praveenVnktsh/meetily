use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Command on macOS, Control elsewhere.
#[cfg(target_os = "macos")]
const CMD_OR_CTRL: Modifiers = Modifiers::SUPER;
#[cfg(not(target_os = "macos"))]
const CMD_OR_CTRL: Modifiers = Modifiers::CONTROL;

/// Toggle recording from anywhere (start when idle, stop when recording).
pub fn toggle_recording_shortcut() -> Shortcut {
    Shortcut::new(Some(CMD_OR_CTRL | Modifiers::SHIFT), Code::KeyR)
}

/// Show or hide the main window from anywhere.
pub fn toggle_window_shortcut() -> Shortcut {
    Shortcut::new(Some(CMD_OR_CTRL | Modifiers::SHIFT), Code::KeyM)
}

/// Register the app-wide shortcuts.
///
/// Failures (for example when another app already owns the combination) are
/// logged rather than fatal so the rest of the app keeps working.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let shortcuts = app.global_shortcut();

    if let Err(error) = shortcuts.on_shortcut(toggle_recording_shortcut(), |app, _, event| {
        if event.state == ShortcutState::Pressed {
            crate::tray::toggle_recording_handler(app);
        }
    }) {
        log::warn!("Failed to register recording shortcut: {}", error);
    }

    if let Err(error) = shortcuts.on_shortcut(toggle_window_shortcut(), |app, _, event| {
        if event.state == ShortcutState::Pressed {
            crate::tray::toggle_main_window(app);
        }
    }) {
        log::warn!("Failed to register window shortcut: {}", error);
    }
}

#[cfg(test)]
mod tests {
    use super::{toggle_recording_shortcut, toggle_window_shortcut, CMD_OR_CTRL};
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn shortcuts_use_the_command_or_control_modifier_plus_shift() {
        for shortcut in [toggle_recording_shortcut(), toggle_window_shortcut()] {
            assert!(shortcut.mods.contains(CMD_OR_CTRL));
            assert!(shortcut.mods.contains(Modifiers::SHIFT));
        }
    }

    #[test]
    fn recording_and_window_shortcuts_bind_different_keys() {
        assert_eq!(toggle_recording_shortcut().key, Code::KeyR);
        assert_eq!(toggle_window_shortcut().key, Code::KeyM);
        assert_ne!(toggle_recording_shortcut(), toggle_window_shortcut());
    }
}
