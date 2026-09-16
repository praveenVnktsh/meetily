'use client';

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MeetingPromptPage() {
  const [appName, setAppName] = useState('');

  useEffect(() => {
    // Match the app theme (default dark, like the main window).
    try {
      const stored = localStorage.getItem('meetily:theme');
      document.documentElement.classList.toggle('dark', stored !== 'light');
    } catch {
      document.documentElement.classList.add('dark');
    }

    const unlisten = listen<{ appName: string }>('meeting-prompt-show', (event) => {
      setAppName(event.payload.appName);
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      void unlisten.then((fn) => fn());
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const dismiss = async () => {
    await invoke('dismiss_meeting_prompt').catch(() => {});
    await getCurrentWindow().hide();
  };

  const startRecording = async () => {
    await invoke('start_recording_from_prompt').catch(() => {});
    await getCurrentWindow().hide();
  };

  return (
    <main className="flex h-screen w-screen items-center gap-3 rounded-2xl border border-hairline bg-surface-raised px-3 shadow-2xl">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        <Video className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">Meeting detected</p>
        {appName && <p className="truncate text-[11px] text-ink-subtle">{appName}</p>}
      </div>

      <Button size="sm" className="h-7 shrink-0 gap-1.5 px-3" onClick={() => void startRecording()}>
        <Mic className="h-3 w-3" />
        Start
      </Button>

      <button
        aria-label="Dismiss"
        onClick={() => void dismiss()}
        className="shrink-0 rounded-md p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </main>
  );
}
