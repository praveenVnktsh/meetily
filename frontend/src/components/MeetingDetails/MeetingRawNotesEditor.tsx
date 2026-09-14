'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BlockNotesEditor } from '@/components/BlockNotesEditor';
import { createLiveNote, type LiveNotesDocument } from '@/lib/liveNotes';

export function MeetingRawNotesEditor({ meetingId }: { meetingId: string }) {
  const [document, setDocument] = useState<LiveNotesDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFromStore, setLoadedFromStore] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingDocumentRef = useRef<LiveNotesDocument | null>(null);
  const hasPendingSaveRef = useRef(false);

  const emptyDocument = useCallback((): LiveNotesDocument => ({
    version: 1,
    meetingStartedAtMs: Date.now(),
    updatedAt: new Date().toISOString(),
    notes: [createLiveNote(0)],
  }), []);

  const loadNotes = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true);
    try {
      const result = await invoke<LiveNotesDocument | null>('get_meeting_live_notes', { meetingId });
      if (result) {
        setDocument(result);
        setLoadedFromStore(true);
      } else {
        // Keep anything already on screen; only seed an empty editor once.
        setDocument((current) => current ?? emptyDocument());
      }
    } catch (error) {
      console.warn('Could not load original meeting notes:', error);
      setDocument((current) => current ?? emptyDocument());
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [meetingId, emptyDocument]);

  useEffect(() => {
    void loadNotes(true);
  }, [loadNotes]);

  // The live-notes capture unmounts on stop, before the meeting row is finalized.
  // Refetch once the stop pipeline has persisted the notes so nothing disappears.
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ meetingId?: string }>).detail?.meetingId;
      if (id && id !== meetingId) return;
      void loadNotes(false);
    };
    window.addEventListener('meetily:recording-finalized', handler);
    window.addEventListener('meetily:transcription-complete', handler);
    return () => {
      window.removeEventListener('meetily:recording-finalized', handler);
      window.removeEventListener('meetily:transcription-complete', handler);
    };
  }, [meetingId, loadNotes]);

  const handleChange = useCallback((next: LiveNotesDocument) => {
    setDocument(next);
    pendingDocumentRef.current = next;
    hasPendingSaveRef.current = true;
    setSaveState('saving');
    // Let the workspace glow the re-enhance control; enhancement stays manual.
    window.dispatchEvent(new CustomEvent('meetily:raw-notes-changed', { detail: { meetingId } }));
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

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-[var(--ink-subtle)]">Loading your notes…</div>;
  if (!document) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <p className="text-sm font-medium text-[var(--ink-muted)]">No raw notes were taken</p>
          <p className="mt-1 text-xs text-[var(--ink-subtle)]">Notes you type during a meeting will remain available here unchanged.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="meeting-notes-editor raw-notes-editor mx-auto w-full max-w-[860px] px-10 pb-24 pt-6">
        <BlockNotesEditor
          key={`${meetingId}-${loadedFromStore ? 'stored' : 'blank'}`}
          document={document}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
