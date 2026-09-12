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
import { useShell } from '@/contexts/ShellContext';

export type NotesMode = 'enhanced' | 'raw';

const DOCK_RATIO_KEY = 'meetily:workspace-dock-ratio';

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
}) {
  const { compact } = useShell();
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [ratio, setRatio] = useState(62);
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
      setChatOpen(true);
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

      <div className={`flex min-h-0 flex-1 overflow-hidden ${compact ? 'flex-col' : 'flex-row'}`}>
        {/* Center: notes document */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-1.5 overflow-hidden px-8 pb-3">
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
                    title={isGenerating ? 'Stop generating' : 'Re-enhance notes'}
                    aria-label={isGenerating ? 'Stop generating' : 'Re-enhance notes'}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
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

        {/* Transcript / chat dock: right rail when wide, bottom half when compact */}
        {dockVisible && (
          <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-1 ${compact
            ? 'h-1/2 w-full shrink-0 border-t border-hairline'
            : 'w-[min(520px,42vw)] min-w-[340px] shrink-0 border-l border-hairline'}`}>
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
