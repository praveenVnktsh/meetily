"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { SpeakerCorrectionDialog, SpeakerIdentity } from './SpeakerCorrectionDialog';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  isTranscribing?: boolean;
  locked?: boolean;
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
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  isTranscribing = false,
  locked = false,
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
          locked={locked}
        />
        {locked && convertedSegments.length > 0 && (
          <p className="mt-2 text-[11px] text-[#9b978d]">Transcript is locked while the summary is being generated.</p>
        )}
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      {isTranscribing && convertedSegments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#8b887f]" />
          <div>
            <p className="text-sm font-medium text-[#5d5a53]">Transcribing meeting audio…</p>
            <p className="mt-1 text-xs text-[#9b978d]">This can take a moment. Your notes are safe and stay editable meanwhile.</p>
          </div>
        </div>
      ) : (
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
            onSpeakerChange={meetingId && !locked ? handleSpeakerReassignment : undefined}
          />
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
