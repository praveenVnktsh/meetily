'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import {
  consumeDeferredMeetingForAutoSummary,
  generateAutomaticSummary,
} from '@/lib/autoSummary';

interface MeetingEventDetail {
  meetingId: string;
}

export function AutoSummaryProvider() {
  const { isAutoSummary, isModelConfigLoading, modelConfig } = useConfig();
  const activeMeetingIds = useRef(new Set<string>());
  const pendingMeetingIds = useRef(new Set<string>());

  useEffect(() => {
    const startSummary = async (meetingId: string) => {
      if (!isAutoSummary || isModelConfigLoading || activeMeetingIds.current.has(meetingId)) return;

      pendingMeetingIds.current.delete(meetingId);
      activeMeetingIds.current.add(meetingId);
      window.dispatchEvent(new CustomEvent('meetily:auto-summary-requested', {
        detail: { meetingId },
      }));

      try {
        await generateAutomaticSummary(meetingId, modelConfig);
      } catch (error) {
        console.error('[AutoSummary] Failed to start summary:', error);
        toast.error('Automatic summary could not start', {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeMeetingIds.current.delete(meetingId);
      }
    };

    const queueSummary = (meetingId: string) => {
      if (!isAutoSummary) return;
      pendingMeetingIds.current.add(meetingId);
      if (!isModelConfigLoading) void startSummary(meetingId);
    };

    const handleMeetingReady = (event: Event) => {
      const meetingId = (event as CustomEvent<MeetingEventDetail>).detail?.meetingId;
      if (meetingId) queueSummary(meetingId);
    };

    const handleTranscriptionComplete = (event: Event) => {
      const meetingId = (event as CustomEvent<MeetingEventDetail>).detail?.meetingId;
      if (meetingId && consumeDeferredMeetingForAutoSummary(meetingId)) {
        queueSummary(meetingId);
      }
    };

    window.addEventListener('meetily:meeting-ready-for-summary', handleMeetingReady);
    window.addEventListener('meetily:transcription-complete', handleTranscriptionComplete);
    if (isAutoSummary && !isModelConfigLoading) {
      pendingMeetingIds.current.forEach((meetingId) => void startSummary(meetingId));
    }
    return () => {
      window.removeEventListener('meetily:meeting-ready-for-summary', handleMeetingReady);
      window.removeEventListener('meetily:transcription-complete', handleTranscriptionComplete);
    };
  }, [isAutoSummary, isModelConfigLoading, modelConfig]);

  return null;
}
