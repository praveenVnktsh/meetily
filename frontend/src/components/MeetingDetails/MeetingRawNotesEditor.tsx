'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BlockNotesEditor } from '@/components/BlockNotesEditor';
import type { LiveNotesDocument } from '@/lib/liveNotes';

export function MeetingRawNotesEditor({ meetingId }: { meetingId: string }) {
  const [document, setDocument] = useState<LiveNotesDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<LiveNotesDocument | null>('get_meeting_live_notes', { meetingId })
      .then((result) => {
        if (!cancelled) setDocument(result);
      })
      .catch((error) => console.warn('Could not load original meeting notes:', error))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meetingId]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const handleChange = useCallback((next: LiveNotesDocument) => {
    setDocument(next);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void invoke('save_meeting_live_notes', { meetingId, document: next })
        .then(() => setSaveState('saved'))
        .catch((error) => console.warn('Could not save original meeting notes:', error));
    }, 250);
  }, [meetingId]);

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-[#9b978d]">Loading your notes…</div>;
  if (!document) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <p className="text-sm font-medium text-[#5d5a53]">No raw notes were taken</p>
          <p className="mt-1 text-xs text-[#9b978d]">Notes you type during a meeting will remain available here unchanged.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 pb-24 pt-1">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-5 flex min-h-[52px] items-center justify-between">
          <div>
            <p className="text-xs font-medium text-[#5d5a53]">Raw notes</p>
            <p className="mt-0.5 text-[11px] text-[#9b978d]">Exactly what you captured during the meeting</p>
          </div>
          <span className="text-[11px] text-[#9b978d]">{saveState === 'saving' ? 'Saving changes…' : 'All changes saved'}</span>
        </div>
        <div className="min-h-[420px] px-2 py-2">
          <BlockNotesEditor key={meetingId} document={document} onChange={handleChange} />
        </div>
      </div>
    </div>
  );
}
