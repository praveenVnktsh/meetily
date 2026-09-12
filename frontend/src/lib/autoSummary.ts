import { invoke } from '@tauri-apps/api/core';
import type { ModelConfig } from '@/services/configService';
import type { SummaryProcessResponse, Transcript } from '@/types';
import {
  detectAndCacheSummaryLanguage,
  readCachedDetectedSummaryLanguage,
  readMeetingSummaryLanguage,
} from '@/lib/summary-language-preferences';
import { buildLiveNotesSummaryContext, type LiveNotesDocument } from '@/lib/liveNotes';

const PENDING_DEFERRED_SUMMARIES_KEY = 'meetily:pending-deferred-auto-summaries';

function readPendingMeetingIds(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(PENDING_DEFERRED_SUMMARIES_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writePendingMeetingIds(ids: Set<string>) {
  localStorage.setItem(PENDING_DEFERRED_SUMMARIES_KEY, JSON.stringify([...ids]));
}

export function markDeferredMeetingForAutoSummary(meetingId: string) {
  const ids = readPendingMeetingIds();
  ids.add(meetingId);
  writePendingMeetingIds(ids);
}

export function consumeDeferredMeetingForAutoSummary(meetingId: string): boolean {
  const ids = readPendingMeetingIds();
  if (!ids.delete(meetingId)) return false;
  writePendingMeetingIds(ids);
  return true;
}

async function fetchAllTranscripts(meetingId: string): Promise<Transcript[]> {
  const firstPage = await invoke<{
    transcripts: Transcript[];
    total_count: number;
  }>('api_get_meeting_transcripts', {
    meetingId,
    limit: 1,
    offset: 0,
  });

  if (firstPage.total_count === 0) return [];

  const allTranscripts = await invoke<{
    transcripts: Transcript[];
  }>('api_get_meeting_transcripts', {
    meetingId,
    limit: firstPage.total_count,
    offset: 0,
  });
  return allTranscripts.transcripts;
}

async function resolveSummaryLanguage(meetingId: string, transcriptTexts: string[]) {
  const meetingPreference = await readMeetingSummaryLanguage(meetingId).catch(() => null);
  if (meetingPreference?.language) return meetingPreference.language;

  const cachedLanguage = await readCachedDetectedSummaryLanguage(meetingId).catch(() => null);
  if (cachedLanguage) return cachedLanguage;

  const detected = await detectAndCacheSummaryLanguage(meetingId, transcriptTexts).catch(() => null);
  return detected?.language ?? null;
}

export async function generateAutomaticSummary(meetingId: string, modelConfig: ModelConfig) {
  const existing = await invoke<SummaryProcessResponse>('api_get_summary', { meetingId });
  if (existing.status !== 'idle') {
    return { started: false, reason: 'summary-exists' as const };
  }

  const transcripts = await fetchAllTranscripts(meetingId);
  const transcriptTexts = transcripts.map(({ text }) => text.trim()).filter(Boolean);
  if (transcriptTexts.length === 0) {
    return { started: false, reason: 'empty-transcript' as const };
  }

  // Anchor the enhanced notes on whatever the user typed during the meeting.
  const liveNotes = await invoke<LiveNotesDocument | null>('get_meeting_live_notes', { meetingId })
    .catch(() => null);
  const notesContext = buildLiveNotesSummaryContext(liveNotes);

  const summaryLanguage = await resolveSummaryLanguage(meetingId, transcriptTexts);
  await invoke('api_process_transcript', {
    text: transcriptTexts.join('\n'),
    model: modelConfig.provider,
    modelName: modelConfig.model,
    meetingId,
    chunkSize: 40000,
    overlap: 1000,
    customPrompt: notesContext,
    templateId: 'standard_meeting',
    summaryLanguage,
  });

  return { started: true, reason: 'started' as const };
}
