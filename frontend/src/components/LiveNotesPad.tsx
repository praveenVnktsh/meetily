'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { invoke } from '@tauri-apps/api/core';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import {
  createLiveNote,
  LIVE_NOTES_FALLBACK_KEY,
  LIVE_NOTES_FALLBACK_FOLDER_KEY,
  type LiveNote,
  type LiveNotesDocument,
} from '@/lib/liveNotes';

const BlockNotesEditor = dynamic(
  () => import('@/components/BlockNotesEditor').then((module) => module.BlockNotesEditor),
  {
    ssr: false,
    loading: () => <div className="text-sm text-[#9b978d]">Opening notes…</div>,
  },
);

function storedFallback(folderPath: string | null): LiveNotesDocument | null {
  try {
    if (!folderPath || localStorage.getItem(LIVE_NOTES_FALLBACK_FOLDER_KEY) !== folderPath) return null;
    const raw = localStorage.getItem(LIVE_NOTES_FALLBACK_KEY);
    return raw ? JSON.parse(raw) as LiveNotesDocument : null;
  } catch {
    return null;
  }
}

export function LiveNotesPad() {
  const { isRecording, recordingDuration } = useRecordingState();
  const [document, setDocument] = useState<LiveNotesDocument | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const durationRef = useRef(0);
  durationRef.current = recordingDuration ?? 0;

  const persist = useCallback(async (next: LiveNotesDocument, targetFolder: string | null) => {
    localStorage.setItem(LIVE_NOTES_FALLBACK_KEY, JSON.stringify(next));
    if (targetFolder) localStorage.setItem(LIVE_NOTES_FALLBACK_FOLDER_KEY, targetFolder);
    if (!targetFolder) return;
    setSaveState('saving');
    try {
      await invoke('save_live_notes', { folderPath: targetFolder, document: next });
      setSaveState('saved');
    } catch (error) {
      console.warn('Could not persist live notes to the meeting folder:', error);
    }
  }, []);

  const scheduleSave = useCallback((next: LiveNotesDocument) => {
    localStorage.setItem(LIVE_NOTES_FALLBACK_KEY, JSON.stringify(next));
    if (folderPath) localStorage.setItem(LIVE_NOTES_FALLBACK_FOLDER_KEY, folderPath);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next, folderPath), 180);
  }, [folderPath, persist]);

  useEffect(() => {
    if (!isRecording) return;
    let cancelled = false;
    const initialize = async () => {
      let path: string | null = null;
      for (let attempt = 0; attempt < 8 && !path && !cancelled; attempt += 1) {
        path = await invoke<string | null>('get_meeting_folder_path').catch(() => null);
        if (!path) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (cancelled) return;
      setFolderPath(path);
      const fromDisk = path
        ? await invoke<LiveNotesDocument | null>('load_live_notes', { folderPath: path }).catch(() => null)
        : null;
      const fallback = storedFallback(path);
      const initial = fromDisk ?? fallback ?? {
        version: 1,
        meetingStartedAtMs: Date.now() - (durationRef.current * 1000),
        updatedAt: new Date().toISOString(),
        notes: [createLiveNote(durationRef.current)],
      };
      setDocument(initial);
      void persist(initial, path);
    };
    void initialize();
    return () => { cancelled = true; };
  }, [isRecording, persist]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const handleDocumentChange = useCallback((next: LiveNotesDocument) => {
    setDocument(next);
    scheduleSave(next);
  }, [scheduleSave]);

  if (!document) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">Preparing notes…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#fbfaf7]">
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <div className="text-sm font-medium text-[#272622]">Your notes</div>
          <div className="text-xs text-[#8b887f]">Use / for blocks and Markdown · AI will enrich these after the meeting</div>
        </div>
        <span className="text-[11px] text-[#9b978d]">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-36 pt-3">
        <div className="mx-auto min-h-full max-w-[820px] rounded-2xl bg-white px-8 py-8 shadow-[0_1px_0_rgba(45,43,37,0.04)]">
          <BlockNotesEditor document={document} onChange={handleDocumentChange} />
        </div>
      </div>
    </div>
  );
}
