'use client';

import React, { ReactNode, createContext, useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import Analytics from '@/lib/analytics';

interface AnalyticsProviderProps {
  children: ReactNode;
}

interface AnalyticsContextType {
  isAnalyticsOptedIn: boolean;
  setIsAnalyticsOptedIn: (optedIn: boolean) => void;
}

export const AnalyticsContext = createContext<AnalyticsContextType>({
  isAnalyticsOptedIn: false,
  setIsAnalyticsOptedIn: () => {},
});

/**
 * Telemetry is intentionally disabled in this distribution. Keep the provider
 * as a compatibility boundary for existing components and stored preferences.
 */
export default function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  useEffect(() => {
    const disableTelemetry = async () => {
      const store = await load('analytics.json', {
        autoSave: false,
        defaults: { analyticsOptedIn: false },
      });
      await store.set('analyticsOptedIn', false);
      await store.save();
      await Analytics.disable();
    };

    disableTelemetry().catch((error) => {
      console.error('Failed to enforce disabled analytics state:', error);
    });
  }, []);

  return (
    <AnalyticsContext.Provider
      value={{ isAnalyticsOptedIn: false, setIsAnalyticsOptedIn: () => {} }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}
