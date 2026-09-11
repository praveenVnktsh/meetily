'use client';

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { primaryMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePlatform } from '@/hooks/usePlatform';
import { detectMeetingApp, type DetectedMeetingApp } from '@/lib/meetingDetection';

const DETECTION_DELAY_MS = 4_000;

interface RecordingPreferences {
  automatic_record_prompt?: boolean;
}

export function MeetingDetectedPrompt({ enabled = true }: { enabled?: boolean }) {
  const platform = usePlatform();
  const { isRecording } = useRecordingState();
  const { handleRecordingToggle } = useSidebar();
  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDismissedRef = useRef(false);
  const isRecordingRef = useRef(isRecording);
  const preferenceEnabledRef = useRef(true);
  const startRecordingRef = useRef(handleRecordingToggle);

  useEffect(() => {
    startRecordingRef.current = handleRecordingToggle;
  }, [handleRecordingToggle]);

  const clearDetectionTimer = useCallback(() => {
    if (detectionTimerRef.current) {
      clearTimeout(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
  }, []);

  const hidePrompt = useCallback(async () => {
    const promptWindow = await WebviewWindow.getByLabel('meeting-prompt');
    await promptWindow?.hide();
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (isRecording) void hidePrompt();
  }, [hidePrompt, isRecording]);

  const showPrompt = useCallback(async (meetingApp: DetectedMeetingApp) => {
    const promptWindow = await WebviewWindow.getByLabel('meeting-prompt');
    if (!promptWindow) {
      console.error('[MeetingDetection] Meeting prompt window is unavailable');
      return;
    }

    const [monitor, windowSize] = await Promise.all([
      primaryMonitor(),
      promptWindow.outerSize(),
    ]);
    if (monitor) {
      const margin = Math.round(16 * monitor.scaleFactor);
      const x = monitor.workArea.position.x + monitor.workArea.size.width - windowSize.width - margin;
      const y = monitor.workArea.position.y + margin;
      await promptWindow.setPosition(new PhysicalPosition(x, y));
    }

    await emitTo('meeting-prompt', 'meeting-prompt-show', {
      appName: meetingApp.name,
    });
    await promptWindow.show();
    await promptWindow.setFocus();
  }, []);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      const preferenceEnabled = (event as CustomEvent<boolean>).detail;
      preferenceEnabledRef.current = preferenceEnabled;

      if (!preferenceEnabled) {
        clearDetectionTimer();
        void hidePrompt();
      }
    };

    window.addEventListener('automaticRecordPromptChanged', handlePreferenceChange);
    return () => window.removeEventListener('automaticRecordPromptChanged', handlePreferenceChange);
  }, [clearDetectionTimer, hidePrompt]);

  useEffect(() => {
    if (!enabled || platform !== 'macos') return;

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const registerListener = async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      const unlisten = await listen<T>(event, handler);
      if (disposed) {
        unlisten();
        return false;
      }
      unlisteners.push(unlisten);
      return true;
    };

    const setup = async () => {
      const preferences = await invoke<RecordingPreferences>('get_recording_preferences');
      if (disposed) return;
      preferenceEnabledRef.current = preferences.automatic_record_prompt !== false;

      if (!await registerListener<null>('meeting-prompt-dismissed', () => {
        sessionDismissedRef.current = true;
        void hidePrompt();
      })) return;

      if (!await registerListener<null>('meeting-prompt-start-recording', () => {
        sessionDismissedRef.current = true;
        void hidePrompt();
        startRecordingRef.current();
      })) return;

      if (!await registerListener<string[]>('system-audio-started', (event) => {
        clearDetectionTimer();
        if (!preferenceEnabledRef.current || isRecordingRef.current) return;

        const meetingApp = detectMeetingApp(event.payload);
        if (!meetingApp) {
          sessionDismissedRef.current = false;
          void hidePrompt();
          return;
        }
        if (sessionDismissedRef.current) return;

        detectionTimerRef.current = setTimeout(async () => {
          if (
            disposed ||
            !preferenceEnabledRef.current ||
            sessionDismissedRef.current ||
            isRecordingRef.current
          ) return;

          await showPrompt(meetingApp).catch((error) => {
            console.warn('[MeetingDetection] Could not show meeting prompt:', error);
          });
        }, DETECTION_DELAY_MS);
      })) return;

      if (!await registerListener<null>('system-audio-stopped', () => {
        clearDetectionTimer();
        sessionDismissedRef.current = false;
        void hidePrompt();
      })) return;

      if (disposed) return;
      await invoke('start_system_audio_monitoring');
    };

    setup().catch((error) => {
      console.error('[MeetingDetection] Failed to start monitoring:', error);
    });

    return () => {
      disposed = true;
      clearDetectionTimer();
      unlisteners.forEach((unlisten) => unlisten());
      void hidePrompt();
    };
  }, [clearDetectionTimer, enabled, hidePrompt, platform, showPrompt]);

  return null;
}
