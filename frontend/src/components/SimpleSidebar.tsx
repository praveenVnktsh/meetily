'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FileAudio, Mic, Search, Settings, Sparkles, Upload, X } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

export default function SimpleSidebar() {
  const router = useRouter();
  const pathname = usePathname();
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

  useEffect(() => {
    const timer = setTimeout(() => void searchTranscripts(query), 250);
    return () => clearTimeout(timer);
  }, [query, searchTranscripts]);

  const visibleMeetings = useMemo(() => {
    if (!query.trim()) return meetings;
    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    return searchResults.map((result) => byId.get(result.id) ?? { id: result.id, title: result.title });
  }, [meetings, query, searchResults]);

  const openMeeting = (meeting: { id: string; title: string }) => {
    setCurrentMeeting(meeting);
    router.push(`/meeting-details?id=${meeting.id}`);
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-[#dedbd2] bg-[#f4f2ec] px-3 pb-3 pt-8 text-[#272622]">
      <div className="titlebar absolute inset-x-0 top-0 h-7" />
      <button
        type="button"
        onClick={() => router.push('/')}
        className="no-drag mb-5 flex items-center gap-2 px-2 text-left"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#272622] text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.02em]">meetily</span>
      </button>

      <button
        type="button"
        onClick={handleRecordingToggle}
        disabled={isRecording}
        className={`mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${isRecording ? 'bg-[#e9ddd8] text-[#a34436]' : 'bg-[#272622] text-white shadow-sm hover:bg-black'}`}
      >
        {isRecording ? (
          <><span className="h-2 w-2 animate-pulse rounded-full bg-[#d74d3f]" /> Recording now</>
        ) : (
          <><Mic className="h-4 w-4" /> New meeting</>
        )}
      </button>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b887f]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search meetings"
          className="h-10 w-full rounded-xl border border-[#dedbd2] bg-white/70 pl-9 pr-9 text-sm outline-none placeholder:text-[#9b978d] focus:border-[#aaa69b] focus:bg-white"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#8b887f] hover:bg-black/5" aria-label="Clear search">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8b887f]">Recent</span>
        {isSearching && <span className="text-[11px] text-[#8b887f]">Searching…</span>}
      </div>
      <nav className="custom-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {visibleMeetings.map((meeting) => {
          const active = pathname?.includes('/meeting-details') && currentMeeting?.id === meeting.id;
          return (
            <button
              key={meeting.id}
              type="button"
              onClick={() => openMeeting(meeting)}
              className={`group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${active ? 'bg-white shadow-sm' : 'hover:bg-white/65'}`}
            >
              <FileAudio className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-[#55735c]' : 'text-[#9b978d]'}`} />
              <span className={`line-clamp-2 text-[13px] leading-5 ${active ? 'font-medium text-[#272622]' : 'text-[#5d5a53]'}`}>{meeting.title}</span>
            </button>
          );
        })}
        {!isSearching && visibleMeetings.length === 0 && (
          <p className="px-3 py-6 text-center text-xs leading-5 text-[#9b978d]">Your meetings will appear here.</p>
        )}
      </nav>

      <div className="mt-3 border-t border-[#dedbd2] pt-3">
        {betaFeatures.importAndRetranscribe && (
          <button type="button" onClick={() => openImportDialog()} className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-[#5d5a53] hover:bg-white/65">
            <Upload className="h-4 w-4" /> Import recording
          </button>
        )}
        <button type="button" onClick={() => router.push('/settings')} className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm ${pathname === '/settings' ? 'bg-white font-medium' : 'text-[#5d5a53] hover:bg-white/65'}`}>
          <Settings className="h-4 w-4" /> Settings
        </button>
      </div>
    </aside>
  );
}
