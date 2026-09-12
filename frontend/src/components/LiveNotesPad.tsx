'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bookmark, Plus, Star } from 'lucide-react';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import {
  createLiveNote,
  formatNoteTimestamp,
  LIVE_NOTES_FALLBACK_KEY,
  LIVE_NOTES_FALLBACK_FOLDER_KEY,
  type LiveNote,
  type LiveNotesDocument,
} from '@/lib/liveNotes';

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
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());
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

  const update = useCallback((updater: (current: LiveNotesDocument) => LiveNotesDocument) => {
    setDocument((current) => {
      if (!current) return current;
      const next = { ...updater(current), updatedAt: new Date().toISOString() };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const addNote = useCallback((important = false) => {
    const note = { ...createLiveNote(durationRef.current), important };
    update((current) => ({ ...current, notes: [...current.notes, note] }));
    requestAnimationFrame(() => textareas.current.get(note.id)?.focus());
  }, [update]);

  if (!document) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">Preparing notes…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#fcfbf8]">
      <div className="flex items-center justify-between border-b border-stone-200 px-6 py-3">
        <div>
          <div className="text-sm font-medium text-stone-800">Live notes</div>
          <div className="text-xs text-stone-400">Saved automatically · timestamps follow the recording</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
          <button
            type="button"
            onClick={() => addNote(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            title="Mark an important moment"
          >
            <Bookmark className="h-3.5 w-3.5" /> Mark moment
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-36 pt-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {document.notes.map((note) => (
            <div key={note.id} className="group flex items-start gap-3">
              <button
                type="button"
                onClick={() => update((current) => ({
                  ...current,
                  notes: current.notes.map((item) => item.id === note.id ? { ...item, important: !item.important } : item),
                }))}
                className={`mt-1 flex min-w-[58px] items-center gap-1 rounded px-1.5 py-1 font-mono text-xs ${note.important ? 'bg-amber-100 text-amber-800' : 'text-stone-400 hover:bg-stone-100'}`}
                title={note.important ? 'Remove important mark' : 'Mark important'}
              >
                {note.important && <Star className="h-3 w-3 fill-current" />}
                {formatNoteTimestamp(note.timestampSeconds)}
              </button>
              <textarea
                ref={(element) => {
                  if (element) textareas.current.set(note.id, element);
                  else textareas.current.delete(note.id);
                }}
                value={note.text}
                rows={1}
                autoFocus={document.notes.length === 1}
                placeholder="Type a note…"
                onChange={(event) => {
                  event.currentTarget.style.height = 'auto';
                  event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                  const text = event.target.value;
                  update((current) => ({
                    ...current,
                    notes: current.notes.map((item) => item.id === note.id ? { ...item, text } : item),
                  }));
                }}
                onBlur={() => void persist(document, folderPath)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    addNote(event.metaKey || event.ctrlKey);
                  }
                }}
                className="min-h-[34px] flex-1 resize-none overflow-hidden border-0 bg-transparent py-1 text-[15px] leading-6 text-stone-800 outline-none placeholder:text-stone-300"
              />
            </div>
          ))}
          <button type="button" onClick={() => addNote()} className="ml-[70px] inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-700">
            <Plus className="h-4 w-4" /> Add note
          </button>
        </div>
      </div>
    </div>
  );
}
