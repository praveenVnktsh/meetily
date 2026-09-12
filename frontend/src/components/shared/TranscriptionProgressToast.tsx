'use client';

import { useEffect } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useSidebar } from '../Sidebar/SidebarProvider';

interface QueueCompleteEvent {
  task_id: string;
  task_type: 'Import' | 'Retranscribe';
  title: string;
  meeting_id: string;
  segments_count: number;
  duration_seconds: number;
}

/**
 * Background transcription no longer shows toast UI: the meeting workspace owns the
 * progress surface now. We still need to fan out queue completion so the open
 * meeting refetches its transcript and auto-summary can start.
 */
export function useTranscriptionProgressToast() {
  const { refetchMeetings } = useSidebar();

  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [];

    unlisteners.push(
      listen<QueueCompleteEvent>('transcription-queue-complete', (event) => {
        const { meeting_id } = event.payload;

        refetchMeetings();
        window.dispatchEvent(new CustomEvent('meetily:transcription-complete', {
          detail: { meetingId: meeting_id },
        }));
      })
    );

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [refetchMeetings]);

  return {};
}

export function TranscriptionProgressToastProvider() {
  useTranscriptionProgressToast();
  return null;
}
