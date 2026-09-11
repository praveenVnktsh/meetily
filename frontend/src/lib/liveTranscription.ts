export const LIVE_TRANSCRIPTION_STORAGE_KEY = 'liveTranscriptEnabled';

/**
 * Live transcription is opt-in. When the feature toggle is unavailable we
 * retain the legacy always-live behavior so existing release configurations
 * continue to work.
 */
export function isLiveTranscriptionEnabled(
  storedValue: string | null,
  toggleFeatureEnabled = true,
): boolean {
  return !toggleFeatureEnabled || storedValue === 'true';
}

export function shouldDeferTranscription(
  storedValue: string | null,
  toggleFeatureEnabled = true,
): boolean {
  return toggleFeatureEnabled && !isLiveTranscriptionEnabled(storedValue, toggleFeatureEnabled);
}
