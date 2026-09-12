'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const COLLAPSED_KEY = 'meetily:sidebar-collapsed';
const THEME_KEY = 'meetily:theme';

interface ShellContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export const SIDEBAR_WIDTH = 280;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  // Phase 1 ships light-default; Phase 2 migrates the workspace to tokens and
  // flips the default to dark. The toggle is already wired for both.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const storedCollapsed = localStorage.getItem(COLLAPSED_KEY);
    if (storedCollapsed != null) setCollapsedState(storedCollapsed === 'true');
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') setThemeState(storedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    localStorage.setItem(COLLAPSED_KEY, String(value));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((current) => {
      localStorage.setItem(COLLAPSED_KEY, String(!current));
      return !current;
    });
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return (
    <ShellContext.Provider value={{ collapsed, setCollapsed, toggleCollapsed, theme, setTheme, toggleTheme }}>
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error('useShell must be used within a ShellProvider');
  }
  return context;
}
