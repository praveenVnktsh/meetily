import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { Copy, GlobeIcon } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

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
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig, betaFeatures } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Live transcription toggle state (only visible when beta feature is enabled)
  const [liveTranscriptEnabled, setLiveTranscriptEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('liveTranscriptEnabled');
    return saved !== null ? saved === 'true' : true;
  });

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
    localStorage.setItem('liveTranscriptEnabled', String(enabled));
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
    <div ref={transcriptContainerRef} className="w-full border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
      {/* Title area - Sticky header */}
      <div className="sticky top-0 z-10 bg-white p-4 border-gray-200">
        <div className="flex flex-col space-y-3">
          <div className="flex  flex-col space-y-2">
            <div className="flex justify-center  items-center space-x-2">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copy Transcript"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      Copy
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="Language"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      Language
                    </span>
                  </Button>
                }
              </ButtonGroup>
              {showLiveTranscriptToggle && (
                <div className="flex items-center gap-2 ml-3">
                  <Switch
                    checked={liveTranscriptEnabled}
                    onCheckedChange={handleLiveTranscriptToggle}
                    disabled={isRecording}
                  />
                  <span className={`text-xs ${isRecording ? 'text-gray-300' : 'text-gray-500'}`}>
                    Live transcription{isRecording ? ' (locked)' : ''}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className="pb-20">
        {isRecording && (!showLiveTranscriptToggle || !liveTranscriptEnabled) ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <div className="h-8 w-8 rounded-full bg-red-500 animate-pulse" />
            <p className="text-sm text-gray-400">
              Recording{!liveTranscriptEnabled && showLiveTranscriptToggle ? ' (live transcription off)' : '...'}
            </p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-2/3 max-w-[750px]">
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
    </div>
  );
}
