'use client';

import { toast } from 'sonner';
import { RecordingControls } from '@/components/RecordingControls';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, useShell } from '@/contexts/ShellContext';

/** Floating recording bar shown over the workspace while a meeting is recording. */
export function FloatingRecordingControls({ onStopInitiated }: { onStopInitiated?: () => void }) {
  const recordingState = useRecordingState();
  const { selectedDevices } = useConfig();
  const { meetingTitle } = useTranscripts();
  const { collapsed } = useShell();

  const { handleRecordingStop } = useRecordingStop(
    () => {},
    () => {},
  );

  return (
    <div
      className="pointer-events-none fixed bottom-8 right-0 z-30 transition-[left] duration-200"
      style={{ left: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
    >
      <div className="flex justify-center">
        <div className="pointer-events-auto">
          <RecordingControls
            isRecording={recordingState.isRecording}
            barHeights={[]}
            onRecordingStop={(callApi = true) => handleRecordingStop(callApi)}
            onRecordingStart={() => {}}
            onTranscriptReceived={() => {}}
            onStopInitiated={onStopInitiated}
            isRecordingDisabled={false}
            isParentProcessing={recordingState.isProcessing}
            selectedDevices={selectedDevices}
            meetingName={meetingTitle}
            onTranscriptionError={(message) => toast.error(message)}
          />
        </div>
      </div>
    </div>
  );
}
