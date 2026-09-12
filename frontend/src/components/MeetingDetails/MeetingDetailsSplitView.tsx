'use client';

import type { ReactNode } from 'react';
import { FileText, MessageCircle, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { value: 'summary' as const, label: 'Notes', icon: Sparkles },
  { value: 'transcript' as const, label: 'Transcript', icon: FileText },
  { value: 'assistant' as const, label: 'Ask', icon: MessageCircle },
];

export type MeetingDetailsTab = 'transcript' | 'summary' | 'assistant';

export function MeetingDetailsSplitView({
  transcript,
  summary,
  assistant,
  title,
  createdAt,
  activeTab,
  onTabChange,
}: {
  transcript: ReactNode;
  summary: ReactNode;
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
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e5e2da] bg-[#fbfaf7] px-8">
        <div className="min-w-0 pr-6">
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-[#272622]">{title}</h1>
          {dateLabel && <p className="mt-0.5 text-xs text-[#8b887f]">{dateLabel}</p>}
        </div>
        <TabsList className="h-10 rounded-xl bg-[#efede7] p-1">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5 rounded-lg px-4 text-xs text-[#77736a] data-[state=active]:bg-white data-[state=active]:text-[#272622] data-[state=active]:shadow-sm">
              <Icon className="h-3.5 w-3.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TabsContent value="summary" className="mt-0 h-full data-[state=inactive]:hidden">{summary}</TabsContent>
        <TabsContent value="transcript" className="mt-0 h-full data-[state=inactive]:hidden">{transcript}</TabsContent>
        <TabsContent value="assistant" className="mt-0 h-full data-[state=inactive]:hidden">{assistant}</TabsContent>
      </div>
    </Tabs>
  );
}
