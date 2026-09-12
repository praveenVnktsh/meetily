'use client';

import type { ReactNode } from 'react';
import { FileText, ListTree, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { value: 'summary' as const, label: 'Enhanced notes', icon: Sparkles },
  { value: 'raw' as const, label: 'Raw notes', icon: ListTree },
  { value: 'transcript' as const, label: 'Transcript', icon: FileText },
];

export type MeetingDetailsTab = 'transcript' | 'summary' | 'raw';

export function MeetingDetailsSplitView({
  transcript,
  summary,
  rawNotes,
  assistant,
  title,
  createdAt,
  activeTab,
  onTabChange,
}: {
  transcript: ReactNode;
  summary: ReactNode;
  rawNotes: ReactNode;
  assistant: ReactNode;
  title: string;
  createdAt: string;
  activeTab: MeetingDetailsTab;
  onTabChange: (tab: MeetingDetailsTab) => void;
}) {
  const date = new Date(createdAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    }).format(date);

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as MeetingDetailsTab)} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfaf7]">
      <div className="flex min-h-[76px] shrink-0 items-center justify-between gap-6 px-8 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#272622]">{title}</h1>
          {dateLabel && <p className="mt-0.5 text-xs text-[#8b887f]">{dateLabel}</p>}
        </div>
        <TabsList className="h-10 shrink-0 rounded-full bg-[#efede7] p-1">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5 rounded-full px-3.5 text-xs text-[#77736a] data-[state=active]:bg-white data-[state=active]:text-[#272622] data-[state=active]:shadow-[0_1px_5px_rgba(45,43,37,0.08)]">
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden">
          <TabsContent value="summary" className="mt-0 h-full data-[state=inactive]:hidden">{summary}</TabsContent>
          <TabsContent value="raw" className="mt-0 h-full data-[state=inactive]:hidden">{rawNotes}</TabsContent>
          <TabsContent value="transcript" className="mt-0 h-full data-[state=inactive]:hidden">{transcript}</TabsContent>
        </div>
        <aside className="h-full w-[min(340px,32vw)] min-w-[300px] shrink-0 overflow-hidden bg-[#f4f2ed]">
          {assistant}
        </aside>
      </div>
    </Tabs>
  );
}
