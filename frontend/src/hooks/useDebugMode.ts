import { useEffect, useState } from 'react';
import { cachedDebugMode, loadDebugMode } from '@/lib/debugMode';

/** React binding for the debug-mode preference (backend is the source of truth). */
export function useDebugMode(): boolean {
  const [enabled, setEnabled] = useState(cachedDebugMode);

  useEffect(() => {
    let cancelled = false;
    void loadDebugMode().then((value) => {
      if (!cancelled) setEnabled(value);
    });

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setEnabled(typeof detail === 'boolean' ? detail : cachedDebugMode());
    };
    window.addEventListener('debug-mode-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('debug-mode-changed', handler);
    };
  }, []);

  return enabled;
}
