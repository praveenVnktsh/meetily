export interface LiveNote {
  id: string;
  timestampSeconds: number;
  text: string;
  important: boolean;
}

export interface LiveNotesDocument {
  version: 1;
  meetingStartedAtMs: number;
  updatedAt: string;
  notes: LiveNote[];
}

export const LIVE_NOTES_FALLBACK_KEY = 'meetily.liveNotes.current';
export const LIVE_NOTES_FALLBACK_FOLDER_KEY = 'meetily.liveNotes.currentFolder';

export function formatNoteTimestamp(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60).toString().padStart(2, '0')}:${(wholeSeconds % 60).toString().padStart(2, '0')}`;
}

export function createLiveNote(timestampSeconds: number): LiveNote {
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: randomId, timestampSeconds, text: '', important: false };
}

export function buildLiveNotesSummaryContext(document: LiveNotesDocument | null): string {
  if (!document?.notes.some((note) => note.text.length > 0)) return '';
  const notes = document.notes
    .filter((note) => note.text.length > 0)
    .map((note) => `[${formatNoteTimestamp(note.timestampSeconds)}]${note.important ? ' IMPORTANT' : ''}\n${note.text}`)
    .join('\n\n');
  return [
    'The following are the user\'s original live notes. Treat them as strong attention signals when deciding what to expand, emphasize, and include. Use the transcript as supporting evidence. Never rewrite, replace, or claim to edit the original notes.',
    '<user_live_notes>',
    notes,
    '</user_live_notes>',
  ].join('\n');
}
