"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2, Search, X } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  // Local speaker edits applied in place so renaming/reassigning does not
  // refetch (and reset) the transcript scroll position.
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [segmentSpeakerIds, setSegmentSpeakerIds] = useState<Record<string, string>>({});

  useEffect(() => {
    setSpeakerNames(
      Object.fromEntries(speakerOptions.map((speaker) => [speaker.speaker_id, speaker.display_name])),
    );
  }, [speakerOptions]);

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
    // Apply optimistically; no transcript refetch so scroll position is kept.
    setSegmentSpeakerIds((current) => ({ ...current, [transcriptId]: speakerId }));
    try {
      await invoke('reassign_transcript_speaker', { meetingId, transcriptId, speakerId });
      await refreshSpeakers();
      toast.success('Transcript segment reassigned');
    } catch (error) {
      setSegmentSpeakerIds((current) => {
        const next = { ...current };
        delete next[transcriptId];
        return next;
      });
      toast.error(`Could not reassign speaker: ${String(error)}`);
    }
  }, [meetingId, refreshSpeakers]);

  const handleRenameSpeaker = useCallback(async (speakerId: string, displayName: string) => {
    if (!meetingId) return;
    // Apply optimistically to every segment with this speaker id.
    const previous = speakerNames[speakerId];
    setSpeakerNames((current) => ({ ...current, [speakerId]: displayName }));
    try {
      await invoke('rename_speaker', { meetingId, speakerId, displayName });
      await refreshSpeakers();
      toast.success(`Renamed to ${displayName}`);
    } catch (error) {
      setSpeakerNames((current) => {
        const next = { ...current };
        if (previous === undefined) delete next[speakerId];
        else next[speakerId] = previous;
        return next;
      });
      toast.error(`Could not rename speaker: ${String(error)}`);
    }
  }, [meetingId, refreshSpeakers, speakerNames]);

  // Merging remaps speaker identities, so reload transcripts from the database.
  const handleSpeakersChanged = useCallback(async () => {
    await onRefetchTranscripts?.();
    await refreshSpeakers();
  }, [onRefetchTranscripts, refreshSpeakers]);

  // Convert transcripts to segments, then apply any in-place speaker edits.
  const convertedSegments = useMemo(() => {
    const base = (usePagination && segments)
      ? segments
      : transcripts.map(t => ({
          id: t.id,
          timestamp: t.audio_start_time ?? 0,
          endTime: t.audio_end_time,
          text: t.text,
          confidence: t.confidence,
          speaker: t.speaker,
          speakerId: t.speaker_id,
        }));

    return base.map((segment) => {
      const speakerId = segmentSpeakerIds[segment.id] ?? segment.speakerId ?? segment.speaker;
      const displayName = (speakerId ? speakerNames[speakerId] : undefined)
        ?? segment.speaker
        ?? speakerId;
      if (speakerId === segment.speakerId && displayName === segment.speaker) return segment;
      return { ...segment, speakerId, speaker: displayName };
    });
  }, [transcripts, usePagination, segments, speakerNames, segmentSpeakerIds]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const displaySegments = useMemo(() => {
    if (!normalizedQuery) return convertedSegments;
    return convertedSegments.filter((segment) => segment.text.toLowerCase().includes(normalizedQuery));
  }, [convertedSegments, normalizedQuery]);

  return (
    <div className="flex h-full min-w-0 w-full bg-[var(--surface-0)] flex-col relative @container">
      {/* Title area */}
      <div className="mx-auto w-full max-w-[900px] px-8 pb-2 pt-4">
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
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-subtle)]" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search transcript…"
            className="h-9 w-full rounded-xl border border-hairline bg-[var(--surface-1)] pl-9 pr-9 text-sm text-ink outline-none placeholder:text-[var(--ink-subtle)] focus:border-[var(--ink-subtle)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink-subtle)] hover:bg-[var(--surface-2)]"
              aria-label="Clear transcript search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {locked && convertedSegments.length > 0 && (
          <p className="mt-2 text-[11px] text-[var(--ink-subtle)]">Transcript is locked while the summary is being generated.</p>
        )}
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      {isTranscribing && convertedSegments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-subtle)]" />
          <div>
            <p className="text-sm font-medium text-[var(--ink-muted)]">Transcribing meeting audio…</p>
            <p className="mt-1 text-xs text-[var(--ink-subtle)]">This can take a moment. Your notes are safe and stay editable meanwhile.</p>
          </div>
        </div>
      ) : normalizedQuery && displaySegments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 pb-16 text-center text-sm text-[var(--ink-subtle)]">
          No transcript matches “{searchQuery.trim()}”.
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[900px] flex-1 overflow-hidden pb-4">
          <VirtualizedTranscriptView
            segments={displaySegments}
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
            onRenameSpeaker={meetingId && !locked ? handleRenameSpeaker : undefined}
          />
        </div>
      )}

      {meetingId && (
        <SpeakerCorrectionDialog
          open={showSpeakerDialog}
          onOpenChange={setShowSpeakerDialog}
          meetingId={meetingId}
          speakers={speakerOptions}
          onChanged={handleSpeakersChanged}
          onRenamed={handleRenameSpeaker}
        />
      )}
    </div>
  );
}
