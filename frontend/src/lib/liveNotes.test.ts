import { describe, expect, it } from 'bun:test';
import { buildLiveNotesSummaryContext, formatNoteTimestamp, type LiveNotesDocument } from './liveNotes';

describe('live meeting notes', () => {
  it('formats recording-relative timestamps', () => {
    expect(formatNoteTimestamp(65.9)).toBe('01:05');
    expect(formatNoteTimestamp(-2)).toBe('00:00');
  });

  it('preserves original note text in summary context', () => {
    const document: LiveNotesDocument = {
      version: 1,
      meetingStartedAtMs: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      notes: [{
        id: 'one',
        timestampSeconds: 12,
        text: '  Exact wording\nwith spacing  ',
        important: true,
      }],
    };
    const context = buildLiveNotesSummaryContext(document);
    expect(context).toContain('[00:12] IMPORTANT\n  Exact wording\nwith spacing  ');
  });

  it('returns raw markdown when present', () => {
    const document: LiveNotesDocument = {
      version: 2,
      meetingStartedAtMs: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      notes: [],
      rawMarkdown: '- ship the release',
    };
    expect(buildLiveNotesSummaryContext(document)).toBe('- ship the release');
  });
});
