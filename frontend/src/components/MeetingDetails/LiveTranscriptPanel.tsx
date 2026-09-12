'use client';

import { useMemo } from 'react';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';

/**
 * Live transcript for an in-progress recording, rendered inside the meeting
 * workspace dock so recording looks the same as the rest of the app.
 */
export function LiveTranscriptPanel() {
  const { transcripts } = useTranscripts();
  const { isRecording, isPaused, isProcessing, isStopping } = useRecordingState();

  const segments = useMemo(
    () =>
      transcripts.map((t) => ({
        id: t.id,
        timestamp: t.audio_start_time ?? 0,
        endTime: t.audio_end_time,
        text: t.text,
        confidence: t.confidence,
        speaker: t.speaker,
        speakerId: t.speaker_id,
      })),
    [transcripts]
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--surface-0)] text-ink">
      <div className="mx-auto w-full max-w-[900px] px-8 pb-2 pt-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d74d3f]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#d74d3f]" /> Recording
        </div>
      </div>
      {segments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 pb-16 text-center text-sm text-[var(--ink-subtle)]">
          Listening… live transcript will appear here as people speak.
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[900px] flex-1 overflow-hidden pb-4">
          <VirtualizedTranscriptView
            segments={segments}
            isRecording={isRecording}
            isPaused={isPaused}
            isProcessing={isProcessing}
            isStopping={isStopping}
            enableStreaming={isRecording}
            showConfidence
          />
        </div>
      )}
    </div>
  );
}
