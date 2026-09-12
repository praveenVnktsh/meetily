'use client';

import { useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MeetingPromptPage() {
  const [appName, setAppName] = useState('A meeting app');

  useEffect(() => {
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
    await emit('meeting-prompt-dismissed');
    await getCurrentWindow().hide();
  };

  const startRecording = async () => {
    await emit('meeting-prompt-start-recording');
    await getCurrentWindow().hide();
  };

  return (
    <main
      className="h-screen w-screen overflow-hidden rounded-2xl border border-hairline bg-surface-raised p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Video className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-sm font-semibold text-ink">Meeting detected</h1>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                {appName} appears to be active. Start recording?
              </p>
            </div>
            <button
              aria-label="Dismiss"
              onClick={() => void dismiss()}
              className="rounded-md p-1 text-ink-subtle hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-ink-muted">
        Recording starts only after confirmation. Remember to inform participants.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => void dismiss()}>
          Not now
        </Button>
        <Button size="sm" onClick={() => void startRecording()} className="gap-2 bg-red-600 hover:bg-red-700">
          <Mic className="h-3.5 w-3.5" />
          Start recording
        </Button>
      </div>
    </main>
  );
}
