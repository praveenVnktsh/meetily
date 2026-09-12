'use client';

import type { ReactNode } from 'react';
import { FileText, MessageCircle, Sparkles } from 'lucide-react';

export type MeetingRightView = 'transcript' | 'summary' | 'assistant';

const RIGHT_VIEWS = [
  { value: 'transcript' as const, label: 'Transcript', icon: FileText },
  { value: 'summary' as const, label: 'Summary', icon: Sparkles },
  { value: 'assistant' as const, label: 'Chat', icon: MessageCircle },
];

export function MeetingDetailsSplitView({
  transcript,
  summary,
  rawNotes,
  assistant,
  title,
  createdAt,
  rightView,
  onRightViewChange,
  showSummary = false,
  showAssistant = false,
  statusBanner,
}: {
  transcript: ReactNode;
  summary: ReactNode;
  rawNotes: ReactNode;
  assistant: ReactNode;
  title: string;
  createdAt: string;
  rightView: MeetingRightView;
  onRightViewChange: (view: MeetingRightView) => void;
  showSummary?: boolean;
  showAssistant?: boolean;
  statusBanner?: ReactNode;
}) {
  const date = new Date(createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);

  const availableViews = RIGHT_VIEWS.filter(({ value }) =>
    value === 'transcript' || (value === 'summary' && showSummary) || (value === 'assistant' && showAssistant)
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfaf7]">
      <div className="flex min-h-[76px] shrink-0 items-center justify-between gap-6 px-8 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#272622]">{title}</h1>
          {dateLabel && <p className="mt-0.5 text-xs text-[#8b887f]">{dateLabel}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {statusBanner}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: raw notes, always editable */}
        <section className="flex w-1/2 min-w-0 flex-col overflow-hidden border-r border-[#e5e2da]">
          {rawNotes}
        </section>

        {/* Right: transcript / summary / chat */}
        <section className="flex w-1/2 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-1 pt-4">
            <div className="flex rounded-full bg-[#efede7] p-1">
              {availableViews.map(({ value, label, icon: Icon }) => {
                const isActive = rightView === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onRightViewChange(value)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs transition-colors ${isActive
                      ? 'bg-white text-[#272622] shadow-[0_1px_5px_rgba(45,43,37,0.08)]'
                      : 'text-[#77736a] hover:text-[#272622]'}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {rightView === 'transcript' && transcript}
            {rightView === 'summary' && showSummary && summary}
            {rightView === 'assistant' && showAssistant && assistant}
          </div>
        </section>
      </div>
    </div>
  );
}
