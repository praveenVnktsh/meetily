'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, Video } from 'lucide-react';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePlatform } from '@/hooks/usePlatform';
import { detectMeetingApp, type DetectedMeetingApp } from '@/lib/meetingDetection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DETECTION_DELAY_MS = 4_000;

interface RecordingPreferences {
  automatic_record_prompt?: boolean;
}

export function MeetingDetectedPrompt({ enabled = true }: { enabled?: boolean }) {
  const platform = usePlatform();
  const { isRecording } = useRecordingState();
  const { handleRecordingToggle } = useSidebar();
  const [detectedApp, setDetectedApp] = useState<DetectedMeetingApp | null>(null);
  const detectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDismissedRef = useRef(false);
  const isRecordingRef = useRef(isRecording);
  const preferenceEnabledRef = useRef(true);
  const startRecordingRef = useRef(handleRecordingToggle);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    startRecordingRef.current = handleRecordingToggle;
  }, [handleRecordingToggle]);

  const clearDetectionTimer = useCallback(() => {
    if (detectionTimerRef.current) {
      clearTimeout(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePreferenceChange = (event: Event) => {
      const preferenceEnabled = (event as CustomEvent<boolean>).detail;
      preferenceEnabledRef.current = preferenceEnabled;

      if (!preferenceEnabled) {
        clearDetectionTimer();
        setDetectedApp(null);
      }
    };

    window.addEventListener('automaticRecordPromptChanged', handlePreferenceChange);
    return () => window.removeEventListener('automaticRecordPromptChanged', handlePreferenceChange);
  }, [clearDetectionTimer]);

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

      if (!await registerListener<string[]>('system-audio-started', (event) => {
        clearDetectionTimer();
        if (!preferenceEnabledRef.current || isRecordingRef.current) return;

        const meetingApp = detectMeetingApp(event.payload);
        if (!meetingApp) {
          sessionDismissedRef.current = false;
          setDetectedApp(null);
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

          try {
            const window = getCurrentWindow();
            await window.show();
            await window.setFocus();
          } catch (error) {
            console.warn('[MeetingDetection] Could not focus Meetily:', error);
          }
          setDetectedApp(meetingApp);
        }, DETECTION_DELAY_MS);
      })) return;

      if (!await registerListener<null>('system-audio-stopped', () => {
        clearDetectionTimer();
        sessionDismissedRef.current = false;
        setDetectedApp(null);
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
    };
  }, [clearDetectionTimer, enabled, platform]);

  const dismissPrompt = useCallback(() => {
    sessionDismissedRef.current = true;
    setDetectedApp(null);
  }, []);

  const startRecording = useCallback(() => {
    sessionDismissedRef.current = true;
    setDetectedApp(null);
    startRecordingRef.current();
  }, []);

  return (
    <Dialog open={detectedApp !== null} onOpenChange={(open) => !open && dismissPrompt()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Video className="h-5 w-5" />
          </div>
          <DialogTitle>Meeting detected</DialogTitle>
          <DialogDescription>
            {detectedApp?.name} appears to be in an active call. Would you like Meetily to start recording?
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Recording only starts after you confirm. Remember to inform meeting participants.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={dismissPrompt}>Not now</Button>
          <Button onClick={startRecording} className="gap-2 bg-red-600 hover:bg-red-700">
            <Mic className="h-4 w-4" />
            Start recording
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
