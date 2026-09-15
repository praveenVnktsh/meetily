import { invoke } from '@tauri-apps/api/core';

const DEBUG_MODE_KEY = 'debugMode';

/**
 * Debug mode records meetings into an isolated "debug" bucket (hidden from the
 * normal list, stored under a recordings/debug folder) and exposes diagnostics.
 */

export function cachedDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(DEBUG_MODE_KEY) === 'true';
}

/** Read the authoritative value from the backend and mirror it locally. */
export async function loadDebugMode(): Promise<boolean> {
  try {
    const enabled = await invoke<boolean>('get_debug_mode');
    localStorage.setItem(DEBUG_MODE_KEY, String(enabled));
    return enabled;
  } catch {
    return cachedDebugMode();
  }
}

export async function setDebugMode(enabled: boolean): Promise<void> {
  localStorage.setItem(DEBUG_MODE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('debug-mode-changed', { detail: enabled }));
  await invoke('set_debug_mode', { enabled });
}
