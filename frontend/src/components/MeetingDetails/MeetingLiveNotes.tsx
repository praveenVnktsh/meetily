'use client';

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, Star } from 'lucide-react';
import { formatNoteTimestamp, type LiveNotesDocument } from '@/lib/liveNotes';
import type { TranscriptSegmentData } from '@/types';

export function MeetingLiveNotes({
  meetingId,
  segments,
}: {
  meetingId: string;
  segments: TranscriptSegmentData[];
}) {
  const [document, setDocument] = useState<LiveNotesDocument | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    invoke<LiveNotesDocument | null>('get_meeting_live_notes', { meetingId })
      .then((result) => { if (!cancelled) setDocument(result); })
      .catch((error) => console.warn('Could not load meeting notes:', error));
    return () => { cancelled = true; };
  }, [meetingId]);

  const visibleNotes = useMemo(
    () => document?.notes.filter((note) => note.text.length > 0) ?? [],
    [document],
  );
  if (!visibleNotes.length) return null;

  const jumpToTranscript = (timestampSeconds: number) => {
    const nearest = segments.reduce<TranscriptSegmentData | null>((best, segment) => {
      if (!best) return segment;
      return Math.abs(segment.timestamp - timestampSeconds) < Math.abs(best.timestamp - timestampSeconds)
        ? segment
        : best;
    }, null);
    if (!nearest) return;
    const element = documentById(`segment-${nearest.id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.animate(
        [{ backgroundColor: 'rgba(251, 191, 36, .22)' }, { backgroundColor: 'transparent' }],
        { duration: 1600 },
      );
      return;
    }
    window.dispatchEvent(new CustomEvent('meetily:jump-to-transcript', {
      detail: { id: nearest.id, index: segments.findIndex((segment) => segment.id === nearest.id) },
    }));
  };

  return (
    <div className="border-b border-stone-200 bg-[#fcfbf8]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your original notes · {visibleNotes.length}</span>
        <ChevronDown className={`h-4 w-4 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="max-h-56 space-y-3 overflow-y-auto px-4 pb-4">
          {visibleNotes.map((note) => (
            <div key={note.id} className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => jumpToTranscript(note.timestampSeconds)}
                className={`mt-0.5 inline-flex min-w-[58px] items-center gap-1 rounded px-1.5 py-1 font-mono text-[11px] ${note.important ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'} hover:ring-1 hover:ring-stone-300`}
                title="Jump to the closest transcript moment"
              >
                {note.important && <Star className="h-3 w-3 fill-current" />}
                {formatNoteTimestamp(note.timestampSeconds)}
              </button>
              <p className="whitespace-pre-wrap text-sm leading-5 text-stone-700">{note.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function documentById(id: string): HTMLElement | null {
  return typeof window === 'undefined' ? null : window.document.getElementById(id);
}
