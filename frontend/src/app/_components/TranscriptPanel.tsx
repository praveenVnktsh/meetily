import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Copy, FileText, GlobeIcon, PencilLine } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  isLiveTranscriptionEnabled,
  LIVE_TRANSCRIPTION_STORAGE_KEY,
} from '@/lib/liveTranscription';
import { LiveNotesPad } from '@/components/LiveNotesPad';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript, meetingTitle } = useTranscripts();
  const { transcriptModelConfig, betaFeatures } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Live transcription toggle state (only visible when beta feature is enabled)
  const [liveTranscriptEnabled, setLiveTranscriptEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isLiveTranscriptionEnabled(localStorage.getItem(LIVE_TRANSCRIPTION_STORAGE_KEY));
  });
  const [recordingView, setRecordingView] = useState<'notes' | 'transcript'>('notes');

  useEffect(() => {
    if (isRecording) setRecordingView('notes');
  }, [isRecording]);

  const handleLiveTranscriptToggle = useCallback(async (enabled: boolean) => {
    // When turning transcription OFF, verify audio saving is enabled
    // (without audio saving, disabling transcription means nothing is captured)
    if (!enabled) {
      try {
        const prefs = await invoke<{ auto_save: boolean }>('get_recording_preferences');
        if (!prefs.auto_save) {
          toast.warning('Audio saving is off', {
            description: 'Live transcription can only be disabled when audio saving is enabled (Settings > Recording). Otherwise no data would be captured.',
            duration: 5000,
          });
          return;
        }
      } catch (err) {
        console.error('[TranscriptPanel] Failed to check recording preferences:', err);
      }
    }

    setLiveTranscriptEnabled(enabled);
    localStorage.setItem(LIVE_TRANSCRIPTION_STORAGE_KEY, String(enabled));
    invoke('set_live_transcription_enabled', { enabled }).catch((err) =>
      console.error('[TranscriptPanel] Failed to set live transcription:', err)
    );
  }, []);

  // Sync initial state to Rust when recording starts
  useEffect(() => {
    if (isRecording && betaFeatures.liveTranscription) {
      invoke('set_live_transcription_enabled', { enabled: liveTranscriptEnabled }).catch((err) =>
        console.error('[TranscriptPanel] Failed to sync live transcription state:', err)
      );
    }
  }, [isRecording, betaFeatures.liveTranscription, liveTranscriptEnabled]);

  const showLiveTranscriptToggle = betaFeatures.liveTranscription;

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  return (
    <div ref={transcriptContainerRef} className="flex h-full w-full flex-col overflow-hidden bg-[var(--surface-0)] text-ink">
      {isRecording ? (
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-0)] px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a34436]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#d74d3f]" /> Recording
            </div>
            <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.02em]">{meetingTitle.replace(/^\+\s*/, '')}</h1>
          </div>
          <div className="flex rounded-xl bg-[var(--surface-2)] p-1">
            <button type="button" onClick={() => setRecordingView('notes')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${recordingView === 'notes' ? 'bg-[var(--surface-raised)] text-ink shadow-sm' : 'text-[var(--ink-muted)]'}`}>
              <PencilLine className="h-3.5 w-3.5" /> Notes
            </button>
            <button type="button" onClick={() => setRecordingView('transcript')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${recordingView === 'transcript' ? 'bg-[var(--surface-raised)] text-ink shadow-sm' : 'text-[var(--ink-muted)]'}`}>
              <FileText className="h-3.5 w-3.5" /> Transcript
            </button>
          </div>
        </header>
      ) : (
        <header className="flex h-[76px] shrink-0 items-center justify-end px-8">
          <div className="flex items-center gap-3 text-xs text-[var(--ink-muted)]">
            {transcriptModelConfig.provider === 'localWhisper' && (
              <button type="button" onClick={() => showModal('languageSettings')} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-black/5">
                <GlobeIcon className="h-3.5 w-3.5" /> Language
              </button>
            )}
            {showLiveTranscriptToggle && (
              <label className="flex items-center gap-2" title="Live transcription is optional; audio is always saved">
                <Switch checked={liveTranscriptEnabled} onCheckedChange={handleLiveTranscriptToggle} />
                Live transcript
              </label>
            )}
          </div>
        </header>
      )}

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-8 pt-2">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Notes are the primary recording surface; transcript remains one click away. */}
      {isRecording && recordingView === 'notes' ? (
        <div className="min-h-0 flex-1">
          <LiveNotesPad />
        </div>
      ) : !isRecording ? (
        <div className="flex flex-1 items-center justify-center px-8 pb-28">
          <div className="max-w-xl text-center">
            <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-[22px] bg-[#e7eee5] text-[#55735c]">
              <PencilLine className="h-7 w-7" />
            </div>
            <h1 className="text-[34px] font-semibold tracking-[-0.04em] text-ink">Ready for your next meeting</h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-6 text-[var(--ink-muted)]">Start once, stay present, and jot only what matters. Minutes records quietly and turns the conversation into useful notes afterward.</p>
            <p className="mt-7 text-xs text-[var(--ink-subtle)]">Live transcription is off by default · audio stays on this Mac</p>
          </div>
        </div>
      ) : (
      <div className="min-h-0 flex-1 pb-20">
        {isRecording && (!showLiveTranscriptToggle || !liveTranscriptEnabled) ? (
          <div className="flex h-full flex-col items-center justify-center space-y-3 text-center">
            <FileText className="h-7 w-7 text-[var(--ink-subtle)]" />
            <p className="text-sm font-medium text-[var(--ink-muted)]">Transcript will appear after the meeting</p>
            <p className="text-xs text-[var(--ink-subtle)]">Your recording is safe. Return to Notes to keep writing.</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-full max-w-[820px]">
              {transcripts?.length > 0 && (
                <div className="flex justify-end px-4 py-2">
                  <Button variant="ghost" size="sm" onClick={copyTranscript}><Copy className="h-4 w-4" /> Copy</Button>
                </div>
              )}
              <VirtualizedTranscriptView
                segments={segments}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                enableStreaming={isRecording}
                showConfidence={true}
              />
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
