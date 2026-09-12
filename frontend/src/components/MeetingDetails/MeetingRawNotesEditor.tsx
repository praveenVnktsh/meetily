'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BlockNotesEditor } from '@/components/BlockNotesEditor';
import { createLiveNote, type LiveNotesDocument } from '@/lib/liveNotes';

export function MeetingRawNotesEditor({ meetingId }: { meetingId: string }) {
  const [document, setDocument] = useState<LiveNotesDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingDocumentRef = useRef<LiveNotesDocument | null>(null);
  const hasPendingSaveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<LiveNotesDocument | null>('get_meeting_live_notes', { meetingId })
      .then((result) => {
        if (cancelled) return;
        // Always provide an editable surface, even when the meeting has no notes yet.
        setDocument(result ?? {
          version: 1,
          meetingStartedAtMs: Date.now(),
          updatedAt: new Date().toISOString(),
          notes: [createLiveNote(0)],
        });
      })
      .catch((error) => {
        console.warn('Could not load original meeting notes:', error);
        if (!cancelled) {
          setDocument({
            version: 1,
            meetingStartedAtMs: Date.now(),
            updatedAt: new Date().toISOString(),
            notes: [createLiveNote(0)],
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [meetingId]);

  const handleChange = useCallback((next: LiveNotesDocument) => {
    setDocument(next);
    pendingDocumentRef.current = next;
    hasPendingSaveRef.current = true;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void invoke('save_meeting_live_notes', { meetingId, document: next })
        .then(() => {
          hasPendingSaveRef.current = false;
          setSaveState('saved');
        })
        .catch((error) => console.warn('Could not save original meeting notes:', error));
    }, 250);
  }, [meetingId]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (hasPendingSaveRef.current && pendingDocumentRef.current) {
      void invoke('save_meeting_live_notes', {
        meetingId,
        document: pendingDocumentRef.current,
      }).catch(() => {});
    }
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
    <div className="h-full overflow-y-auto">
      <div className="meeting-notes-editor raw-notes-editor mx-auto w-full max-w-[860px] px-10 pb-24 pt-8">
        <div className="mb-5 flex min-h-[52px] items-center justify-between">
          <div>
            <p className="text-xs font-medium text-[#5d5a53]">Raw notes</p>
            <p className="mt-0.5 text-[11px] text-[#9b978d]">Exactly what you captured during the meeting</p>
          </div>
          <span className="text-[11px] text-[#9b978d]">{saveState === 'saving' ? 'Saving changes…' : 'All changes saved'}</span>
        </div>
        <BlockNotesEditor key={meetingId} document={document} onChange={handleChange} />
      </div>
    </div>
  );
}
