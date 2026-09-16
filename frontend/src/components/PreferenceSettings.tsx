"use client"

import { useEffect, useState, useRef } from "react"
import { Switch } from "./ui/switch"
import { FolderOpen, Keyboard, X } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import Analytics from "@/lib/analytics"
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"
import { usePlatform } from "@/hooks/usePlatform"
import { UpdateSettings } from "./UpdateSettings"

const OS_MODIFIER_KEYS = /^(Meta|Control|Alt|Shift)/

/** Build a global-hotkey string (e.g. "CmdOrCtrl+Shift+KeyR") from a key event. */
function eventToShortcut(event: KeyboardEvent, isMac: boolean): string | null {
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const secondary = isMac ? event.ctrlKey : event.metaKey;
  const mods: string[] = [];
  if (primary) mods.push("CmdOrCtrl");
  else if (secondary) mods.push(isMac ? "Control" : "Super");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");

  const code = event.code;
  if (!code || OS_MODIFIER_KEYS.test(code)) return null; // modifier-only
  if (mods.length === 0) return null; // require at least one modifier

  return [...mods, code].join("+");
}

/** Render a stored shortcut as a friendly label. */
function displayShortcut(value: string, isMac: boolean): string {
  if (!value) return "Not set";
  return value
    .split("+")
    .map((part) => {
      if (part === "CmdOrCtrl") return isMac ? "⌘" : "Ctrl";
      if (part === "Super") return isMac ? "⌘" : "Win";
      if (part === "Control") return "Ctrl";
      if (part === "Alt") return isMac ? "⌥" : "Alt";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      return part.replace(/^Key/, "").replace(/^Digit/, "");
    })
    .join(isMac ? "" : "+");
}

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings
  } = useConfig();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);
  const hasTrackedViewRef = useRef(false);
  const platform = usePlatform();
  const isMac = platform === 'macos';
  const [shortcuts, setShortcuts] = useState<{ recording: string; window: string } | null>(null);
  const [recordingKey, setRecordingKey] = useState<'recording' | 'window' | null>(null);

  useEffect(() => {
    invoke<{ recording: string; window: string }>('get_global_shortcuts')
      .then(setShortcuts)
      .catch((error) => console.warn('Could not load shortcuts:', error));
  }, []);

  useEffect(() => {
    if (!recordingKey || !shortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingKey(null);
        return;
      }
      const value = eventToShortcut(event, isMac);
      if (!value) return;
      const next = { ...shortcuts, [recordingKey]: value };
      setShortcuts(next);
      setRecordingKey(null);
      invoke('set_global_shortcuts', { recording: next.recording, window: next.window })
        .then(() => toast.success('Shortcut updated'))
        .catch((error) => toast.error(`Could not update shortcut: ${String(error)}`));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recordingKey, shortcuts, isMac]);

  const clearShortcut = (which: 'recording' | 'window') => {
    if (!shortcuts) return;
    const next = { ...shortcuts, [which]: '' };
    setShortcuts(next);
    invoke('set_global_shortcuts', { recording: next.recording, window: next.window })
      .then(() => toast.success('Shortcut disabled'))
      .catch((error) => toast.error(`Could not update shortcut: ${String(error)}`));
  };

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();
    // Reset tracking ref on mount (every tab visit)
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  // Track preferences viewed analytics on every tab visit (once per mount)
  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      // Wait for notification settings to be available (either from cache or after loading)
      if (notificationSettings) {
        await Analytics.track('preferences_viewed', {
          notifications_enabled: notificationSettings.notification_preferences.show_recording_started ? 'true' : 'false'
        });
        hasTrackedViewRef.current = true;
      } else if (!isLoadingPreferences) {
        // If not loading and no settings available, track with default value
        await Analytics.track('preferences_viewed', {
          notifications_enabled: 'false'
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        console.log("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log("Successfully updated notification settings to:", notificationsEnabled);

        // Track notification preference change - only fires when user manually toggles
        await Analytics.track('notification_settings_changed', {
          notifications_enabled: notificationsEnabled.toString()
        });
      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  const handleOpenFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      switch (folderType) {
        case 'database':
          await invoke('open_database_folder');
          break;
        case 'models':
          await invoke('open_models_folder');
          break;
        case 'recordings':
          await invoke('open_recordings_folder');
          break;
      }

      // Track storage folder access
      await Analytics.track('storage_folder_opened', {
        folder_type: folderType
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Notifications Section */}
      <div className="bg-surface-raised rounded-lg border border-hairline p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink mb-2">Notifications</h3>
            <p className="text-sm text-ink-muted">Enable or disable notifications of start and end of meeting</p>
          </div>
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
        </div>
      </div>

      {/* Keyboard Shortcuts Section */}
      <div className="bg-surface-raised rounded-lg border border-hairline p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Keyboard className="w-5 h-5 text-ink-muted" />
          <h3 className="text-lg font-semibold text-ink">Keyboard Shortcuts</h3>
        </div>
        <p className="text-sm text-ink-muted mb-4">
          Global shortcuts work even while Minutes is in the background. Click one to record a new
          combination (Esc to cancel).
        </p>
        <ul className="space-y-3">
          {(
            [
              { key: 'recording', label: 'Start or stop recording' },
              { key: 'window', label: 'Show or hide Minutes' },
            ] as const
          ).map(({ key, label }) => (
            <li key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-ink">{label}</span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRecordingKey(key)}
                  className={`rounded border px-2 py-1 text-xs font-medium ${
                    recordingKey === key
                      ? 'border-blue-400 text-blue-500'
                      : 'border-hairline bg-surface-2 text-ink-muted hover:text-ink'
                  }`}
                >
                  {recordingKey === key ? 'Press keys…' : displayShortcut(shortcuts?.[key] ?? '', isMac)}
                </button>
                {shortcuts?.[key] && (
                  <button
                    type="button"
                    onClick={() => clearShortcut(key)}
                    title="Disable this shortcut"
                    className="rounded p-1 text-ink-subtle hover:bg-surface-2 hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink">Open command palette</span>
            <kbd className="rounded border border-hairline bg-surface-2 px-2 py-1 text-xs font-medium text-ink-muted">
              ⌘ / Ctrl + K
            </kbd>
          </li>
        </ul>
      </div>

      {/* Data Storage Locations Section */}
      <div className="bg-surface-raised rounded-lg border border-hairline p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-ink mb-4">Data Storage Locations</h3>
        <p className="text-sm text-ink-muted mb-6">
          View and access where Minutes stores your data
        </p>

        <div className="space-y-4">
          {/* Database Location */}
          {/* <div className="p-4 border rounded-lg bg-surface-2">
            <div className="font-medium mb-2">Database</div>
            <div className="text-sm text-ink-muted mb-3 break-all font-mono text-xs">
              {storageLocations?.database || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('database')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-hairline rounded-md hover:bg-surface-2 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Models Location */}
          {/* <div className="p-4 border rounded-lg bg-surface-2">
            <div className="font-medium mb-2">Whisper Models</div>
            <div className="text-sm text-ink-muted mb-3 break-all font-mono text-xs">
              {storageLocations?.models || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('models')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-hairline rounded-md hover:bg-surface-2 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Recordings Location */}
          <div className="p-4 border rounded-lg bg-surface-2">
            <div className="font-medium mb-2">Meeting Recordings</div>
            <div className="text-sm text-ink-muted mb-3 break-all font-mono text-xs">
              {storageLocations?.recordings || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('recordings')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-hairline rounded-md hover:bg-surface-2 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> Database and models are stored together in your application data directory for unified management.
          </p>
        </div>
      </div>

      <UpdateSettings />
    </div>
  )
}
