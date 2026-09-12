'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AudioLines,
  Home,
  Mic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useShell } from '@/contexts/ShellContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

function formatMeetingDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SimpleSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { collapsed, toggleCollapsed, theme, toggleTheme } = useShell();
  const {
    meetings,
    currentMeeting,
    setCurrentMeeting,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
  } = useSidebar();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => void searchTranscripts(query), 250);
    return () => clearTimeout(timer);
  }, [query, searchTranscripts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (collapsed) toggleCollapsed();
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed, toggleCollapsed]);

  const visibleMeetings = useMemo(() => {
    if (!query.trim()) return meetings;
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    return searchResults.map((result) => byId.get(result.id) ?? { id: result.id, title: result.title, created_at: undefined });
  }, [meetings, query, searchResults]);

  const openMeeting = (meeting: { id: string; title: string; created_at?: string }) => {
    setCurrentMeeting(meeting);
    router.push(`/meeting-details?id=${meeting.id}`);
  };

  const navItems = [
    { label: 'Home', icon: Home, active: pathname === '/', onClick: () => router.push('/') },
    {
      label: 'Meetings',
      icon: Video,
      active: Boolean(pathname?.includes('/meeting-details')),
      onClick: () => router.push('/'),
    },
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-hairline bg-surface-1 pb-4 text-ink transition-[width] duration-200 ease-out ${collapsed ? 'w-[72px] px-2' : 'w-[280px] px-3'
        }`}
    >
      <div className="titlebar absolute inset-x-0 top-0 h-7" />

      {/* Brand + collapse */}
      {collapsed ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="no-drag flex h-7 w-7 items-center justify-center rounded-[10px] bg-brand text-brand-foreground"
            title="minutes"
          >
            <AudioLines className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-2 hover:text-ink"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-8 flex items-center justify-between px-1">
          <button type="button" onClick={() => router.push('/')} className="no-drag flex items-center gap-2 text-left" title="minutes">
            <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-brand text-brand-foreground">
              <AudioLines className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">minutes</span>
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* New meeting */}
      <button
        type="button"
        onClick={handleRecordingToggle}
        disabled={isRecording}
        title={isRecording ? 'Recording now' : 'New meeting'}
        className={`mt-5 flex h-10 items-center gap-2 rounded-xl text-sm font-semibold transition ${collapsed ? 'w-full justify-center px-0' : 'w-full px-3'
          } ${isRecording
            ? 'bg-[#3a2320] text-[#e6938a]'
            : 'bg-brand text-brand-foreground hover:opacity-90'}`}
      >
        {isRecording ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#d74d3f]" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {!collapsed && <span>{isRecording ? 'Recording now' : 'New meeting'}</span>}
      </button>

      {/* Import recording */}
      {betaFeatures.importAndRetranscribe && (
        collapsed ? (
          <button
            type="button"
            onClick={() => openImportDialog()}
            title="Import recording"
            className="mt-2 flex h-10 w-full items-center justify-center rounded-xl text-ink-subtle hover:bg-surface-2 hover:text-ink"
          >
            <Upload className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openImportDialog()}
            className="mt-2 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Upload className="h-4 w-4" /> Import recording
          </button>
        )
      )}

      {/* Search */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => {
            toggleCollapsed();
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          className="mt-3 flex h-10 w-full items-center justify-center rounded-xl text-ink-subtle hover:bg-surface-2 hover:text-ink"
          title="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      ) : (
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-10 w-full rounded-xl border border-hairline bg-surface-0 pl-9 pr-14 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:bg-surface-2"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-subtle">
              ⌘K
            </kbd>
          )}
        </div>
      )}

      {/* Primary nav */}
      <nav className="mt-4 space-y-1">
        {navItems.map(({ label, icon: Icon, active, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            title={label}
            className={`flex h-10 w-full items-center gap-3 rounded-xl text-sm transition ${collapsed ? 'justify-center px-0' : 'px-3'
              } ${active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {/* Recent - only meaningful when expanded */}
      {!collapsed && (
        <>
          <div className="mb-2 mt-6 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">Recent</span>
            {isSearching && <span className="text-[11px] text-ink-subtle">Searching…</span>}
          </div>
          <nav className="custom-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {visibleMeetings.map((meeting) => {
              const active = Boolean(pathname?.includes('/meeting-details')) && currentMeeting?.id === meeting.id;
              return (
                <button
                  key={meeting.id}
                  type="button"
                  onClick={() => openMeeting(meeting)}
                  title={meeting.title}
                  className={`group flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
                >
                  <span className={`relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${active ? 'text-[#6ea8fe]' : 'text-ink-subtle'}`}>
                    {active && <span className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#6ea8fe]" />}
                    <Video className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] leading-5 ${active ? 'font-medium text-ink' : 'text-ink-muted'}`}>
                      {meeting.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">
                      {formatMeetingDate(meeting.created_at)}
                    </span>
                  </span>
                </button>
              );
            })}
            {!isSearching && visibleMeetings.length === 0 && (
              <p className="px-3 py-6 text-center text-xs leading-5 text-ink-subtle">Your meetings will appear here.</p>
            )}
          </nav>
        </>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Footer */}
      <div className={collapsed ? 'flex flex-col items-center gap-2 border-t border-hairline pt-3' : 'flex items-center gap-2 border-t border-hairline px-1 pt-3'}>
        <button
          type="button"
          onClick={() => router.push('/settings')}
          className={`rounded-lg p-2 hover:bg-surface-2 hover:text-ink ${pathname === '/settings' ? 'text-ink' : 'text-ink-subtle'}`}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-ink-subtle hover:bg-surface-2 hover:text-ink"
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
