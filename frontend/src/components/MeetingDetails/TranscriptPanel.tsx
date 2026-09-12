"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { SpeakerCorrectionDialog, SpeakerIdentity } from './SpeakerCorrectionDialog';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  const [showSpeakerDialog, setShowSpeakerDialog] = useState(false);
  const [speakerOptions, setSpeakerOptions] = useState<SpeakerIdentity[]>([]);

  const refreshSpeakers = useCallback(async () => {
    if (!meetingId) return;
    try {
      setSpeakerOptions(await invoke<SpeakerIdentity[]>('get_speaker_identities', { meetingId }));
    } catch (error) {
      console.warn('Could not load speaker identities:', error);
    }
  }, [meetingId]);

  useEffect(() => {
    if (meetingId) void refreshSpeakers();
  }, [meetingId, refreshSpeakers, segments]);

  const handleSpeakerReassignment = useCallback(async (transcriptId: string, speakerId: string) => {
    if (!meetingId) return;
    try {
      await invoke('reassign_transcript_speaker', { meetingId, transcriptId, speakerId });
      await onRefetchTranscripts?.();
      await refreshSpeakers();
      toast.success('Transcript segment reassigned');
    } catch (error) {
      toast.error(`Could not reassign speaker: ${String(error)}`);
    }
  }, [meetingId, onRefetchTranscripts, refreshSpeakers]);

  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker: t.speaker,
      speakerId: t.speaker_id,
    }));
  }, [transcripts, usePagination, segments]);

  return (
    <div className="flex h-full min-w-0 w-full bg-[#fbfaf7] flex-col relative @container">
      {/* Title area */}
      <div className="mx-auto w-full max-w-[900px] px-8 py-3">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
          onOpenSpeakerManager={() => setShowSpeakerDialog(true)}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="mx-auto w-full max-w-[900px] flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          speakerOptions={speakerOptions}
          onSpeakerChange={meetingId ? handleSpeakerReassignment : undefined}
        />
      </div>

      {/* Optional context stays available without competing with the transcript. */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="border-t border-[#e5e2da] px-8 py-3">
          <details className="mx-auto w-full max-w-[900px] text-xs text-[#77736a]">
            <summary className="cursor-pointer select-none hover:text-[#272622]">Add context for the AI notes</summary>
            <textarea
              placeholder="People involved, meeting objective, or anything the summary should emphasize…"
              className="mt-3 min-h-[72px] w-full resize-y rounded-xl border border-[#dedbd2] bg-white px-3 py-2 text-sm text-[#272622] outline-none placeholder:text-[#aaa69b] focus:border-[#aaa69b]"
              value={customPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
            />
          </details>
        </div>
      )}

      {meetingId && (
        <SpeakerCorrectionDialog
          open={showSpeakerDialog}
          onOpenChange={setShowSpeakerDialog}
          meetingId={meetingId}
          speakers={speakerOptions}
          onChanged={async () => {
            await onRefetchTranscripts?.();
            await refreshSpeakers();
          }}
        />
      )}
    </div>
  );
}
