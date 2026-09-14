'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'light' | 'dark';

const COLLAPSED_KEY = 'meetily:sidebar-collapsed';
const THEME_KEY = 'meetily:theme';

/** Below this viewport width the app switches to a compact, collapsed layout. */
export const COMPACT_BREAKPOINT = 1280;

interface ShellContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** True when the window is narrow; the sidebar auto-collapses and docks stack. */
  compact: boolean;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export const SIDEBAR_WIDTH = 280;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [theme, setThemeState] = useState<Theme>('dark');
  const [compact, setCompact] = useState(false);
  // Remembers the user's own collapse choice so leaving compact mode restores it.
  const userCollapsedRef = useRef(false);

  useEffect(() => {
    const storedCollapsed = localStorage.getItem(COLLAPSED_KEY) === 'true';
    userCollapsedRef.current = storedCollapsed;
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') setThemeState(storedTheme);

    const applyViewport = () => {
      const isCompact = window.innerWidth < COMPACT_BREAKPOINT;
      setCompact(isCompact);
      setCollapsedState(isCompact ? true : userCollapsedRef.current);
    };
    applyViewport();
    window.addEventListener('resize', applyViewport);
    return () => window.removeEventListener('resize', applyViewport);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const setCollapsed = useCallback((value: boolean) => {
    userCollapsedRef.current = value;
    setCollapsedState(value);
    localStorage.setItem(COLLAPSED_KEY, String(value));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((current) => {
      const next = !current;
      userCollapsedRef.current = next;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
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
    <ShellContext.Provider value={{ collapsed, setCollapsed, toggleCollapsed, theme, setTheme, toggleTheme, compact }}>
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
