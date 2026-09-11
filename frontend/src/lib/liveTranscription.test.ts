import { describe, expect, test } from 'bun:test';
import { isLiveTranscriptionEnabled, shouldDeferTranscription } from './liveTranscription';

describe('live transcription preference', () => {
  test('defaults to deferred transcription when no preference is saved', () => {
    expect(isLiveTranscriptionEnabled(null)).toBe(false);
    expect(shouldDeferTranscription(null)).toBe(true);
  });

  test('only enables live transcription after explicit opt-in', () => {
    expect(isLiveTranscriptionEnabled('true')).toBe(true);
    expect(shouldDeferTranscription('true')).toBe(false);
    expect(isLiveTranscriptionEnabled('false')).toBe(false);
  });

  test('retains live behavior when the toggle feature is unavailable', () => {
    expect(isLiveTranscriptionEnabled(null, false)).toBe(true);
    expect(shouldDeferTranscription(null, false)).toBe(false);
  });
});
