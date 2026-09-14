'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  ListTree,
  Loader2,
  MessageCircle,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { useShell, SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from '@/contexts/ShellContext';

export type NotesMode = 'enhanced' | 'raw';

const DOCK_RATIO_KEY = 'meetily:workspace-dock-ratio';
const DOCK_WIDTH_KEY = 'meetily:workspace-dock-width';
const DEFAULT_DOCK_WIDTH = 520;

/** Keep the notes column readable: never let the dock take so much that the
 *  notes fall below MIN_NOTES_WIDTH. */
const MIN_NOTES_WIDTH = 520;

function clampDockWidth(value: number, viewportWidth: number, sidebarWidth: number): number {
  const max = Math.max(360, viewportWidth - sidebarWidth - MIN_NOTES_WIDTH);
  return Math.min(max, Math.max(320, value));
}

function formatDateSubtitle(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MeetingWorkspace({
  title,
  createdAt,
  statusBanner,
  notesMode,
  onNotesModeChange,
  canShowEnhanced,
  summary,
  rawNotes,
  transcript,
  assistant,
  showAssistant,
  peopleCount,
  toolbarActions,
  onTitleChange,
  onRegenerate,
  onStopGeneration,
  isGenerating = false,
  notesDirty = false,
}: {
  title: string;
  createdAt: string;
  statusBanner?: ReactNode;
  notesMode: NotesMode;
  onNotesModeChange: (mode: NotesMode) => void;
  canShowEnhanced: boolean;
  summary: ReactNode;
  rawNotes: ReactNode;
  transcript: ReactNode;
  assistant: ReactNode;
  showAssistant: boolean;
  peopleCount: number;
  toolbarActions?: ReactNode;
  onTitleChange?: (title: string) => void;
  onRegenerate?: () => void;
  onStopGeneration?: () => void;
  isGenerating?: boolean;
  notesDirty?: boolean;
}) {
  const { compact, collapsed } = useShell();
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [ratio, setRatio] = useState(62);
  const [dockWidth, setDockWidth] = useState(DEFAULT_DOCK_WIDTH);
  const [titleDraft, setTitleDraft] = useState(title);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(title);
      return;
    }
    if (next !== title) onTitleChange?.(next);
  };

  useEffect(() => {
    const stored = localStorage.getItem(DOCK_RATIO_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) setRatio(Math.min(80, Math.max(20, parsed)));
    }
  }, []);

  // Load the persisted dock width once.
  useEffect(() => {
    const stored = localStorage.getItem(DOCK_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) setDockWidth(parsed);
    }
  }, []);

  // Keep the dock within bounds as the sidebar/compact state or window changes,
  // so the notes never get squeezed.
  useEffect(() => {
    const reclamp = () =>
      setDockWidth((current) => clampDockWidth(current, window.innerWidth, sidebarWidth));
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [sidebarWidth]);

  const onDividerPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startY = event.clientY;
    const startRatio = ratio;

    const move = (moveEvent: PointerEvent) => {
      const deltaPct = ((moveEvent.clientY - startY) / rect.height) * 100;
      const next = Math.min(80, Math.max(20, startRatio + deltaPct));
      setRatio(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRatio((current) => {
        localStorage.setItem(DOCK_RATIO_KEY, String(current));
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [ratio]);

  const onColumnDividerPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;

    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setDockWidth(clampDockWidth(startWidth - delta, window.innerWidth, sidebarWidth));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDockWidth((current) => {
        localStorage.setItem(DOCK_WIDTH_KEY, String(current));
        return current;
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [dockWidth, sidebarWidth]);

  const dateSubtitle = useMemo(() => formatDateSubtitle(createdAt), [createdAt]);
  const dockVisible = transcriptOpen || (chatOpen && showAssistant);

  // Compact mode defaults to everything closed; the user opens a panel on demand.
  // Entering compact closes both, leaving compact restores both.
  const prevCompactRef = useRef(compact);
  useEffect(() => {
    if (compact && !prevCompactRef.current) {
      setTranscriptOpen(false);
      setChatOpen(false);
    } else if (!compact && prevCompactRef.current) {
      setTranscriptOpen(true);
      setChatOpen(false);
    }
    prevCompactRef.current = compact;
  }, [compact]);

  // In compact mode there is only room for one panel, so transcript and chat
  // become mutually exclusive.
  useEffect(() => {
    if (compact && transcriptOpen && chatOpen) setChatOpen(false);
  }, [compact, transcriptOpen, chatOpen]);

  const toggleTranscript = () => {
    setTranscriptOpen((open) => {
      const next = !open;
      if (compact && next) setChatOpen(false);
      return next;
    });
  };

  const toggleChat = () => {
    if (!showAssistant) return;
    setChatOpen((open) => {
      const next = !open;
      if (compact && next) setTranscriptOpen(false);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0 text-ink">
      {/* Header */}
      <div className="flex min-h-[76px] shrink-0 items-center justify-between gap-6 px-8 py-3">
        <div className="min-w-0 flex-1">
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                (event.target as HTMLInputElement).blur();
              } else if (event.key === 'Escape') {
                setTitleDraft(title);
                (event.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            aria-label="Meeting title"
            placeholder="Untitled meeting"
            className="w-full truncate bg-transparent font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-subtle"
          />
          {dateSubtitle && <p className="mt-0.5 text-xs text-ink-subtle">{dateSubtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {statusBanner}
          <button
            type="button"
            onClick={toggleTranscript}
            title="Toggle transcript"
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${transcriptOpen ? 'bg-surface-2 text-ink' : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'}`}
          >
            <FileText className="h-3.5 w-3.5" /> Transcript
          </button>
          <button
            type="button"
            onClick={toggleChat}
            disabled={!showAssistant}
            title="Toggle chat"
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${chatOpen && showAssistant ? 'bg-surface-2 text-ink' : 'text-ink-subtle hover:bg-surface-2 hover:text-ink'} disabled:opacity-40`}
          >
            <MessageCircle className="h-3.5 w-3.5" /> Chat
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Center: notes document */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-8 pb-3">
            {/* Enhanced / Raw segmented toggle */}
            <div className="flex h-8 shrink-0 items-center rounded-full bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => onNotesModeChange('raw')}
                title="Raw notes"
                className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${notesMode === 'raw' ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
              >
                <ListTree className="h-3.5 w-3.5" /> Raw
              </button>
              <div
                className={`flex h-7 items-center rounded-full pr-1 transition-colors ${notesMode === 'enhanced' ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted'}`}
              >
                <button
                  type="button"
                  disabled={!canShowEnhanced}
                  onClick={() => onNotesModeChange('enhanced')}
                  title={canShowEnhanced ? 'Enhanced notes' : 'Enhanced notes appear after the summary is generated'}
                  className="flex h-7 items-center gap-1.5 rounded-full pl-3 pr-2 text-xs disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Enhanced
                </button>
                {canShowEnhanced && (
                  <button
                    type="button"
                    onClick={() => (isGenerating ? onStopGeneration?.() : onRegenerate?.())}
                    title={isGenerating ? 'Stop generating' : notesDirty ? 'Your notes changed — re-enhance to include them' : 'Re-enhance notes'}
                    aria-label={isGenerating ? 'Stop generating' : notesDirty ? 'Your notes changed — re-enhance' : 'Re-enhance notes'}
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink ${notesDirty && !isGenerating ? 'animate-pulse text-amber-500 ring-2 ring-amber-400/70' : ''}`}
                  >
                    {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {toolbarActions && (
              <div className="ml-1 flex shrink-0 items-center gap-1.5">{toolbarActions}</div>
            )}
          </div>

          {/* Document */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {notesMode === 'enhanced' && canShowEnhanced ? summary : rawNotes}
          </div>
        </section>

        {/* Drag handle between the notes column and the side dock */}
        {dockVisible && (
          <div
            onPointerDown={onColumnDividerPointerDown}
            className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center hover:bg-surface-2"
            title="Drag to resize"
          >
            <span className="h-10 w-1 rounded-full bg-hairline group-hover:bg-ink-subtle" />
          </div>
        )}

        {/* Transcript / chat dock: always a right-side rail; collapsed by default in compact */}
        {dockVisible && (
          <section
            className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-hairline bg-surface-1"
            style={{ width: dockWidth }}
          >
            <div ref={dockRef} className="flex min-h-0 flex-1 flex-col">
              {transcriptOpen && (
                <div className="min-h-0 flex-1 overflow-hidden" style={chatOpen && showAssistant ? { flexBasis: `${ratio}%`, flexGrow: 0 } : undefined}>
                  {transcript}
                </div>
              )}
              {transcriptOpen && chatOpen && showAssistant && (
                <div
                  onPointerDown={onDividerPointerDown}
                  className="flex h-3 shrink-0 cursor-row-resize items-center justify-center"
                  title="Drag to resize"
                >
                  <span className="h-1 w-10 rounded-full bg-hairline" />
                </div>
              )}
              {chatOpen && showAssistant && (
                <div className="min-h-0 flex-1 overflow-hidden">
                  {assistant}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
