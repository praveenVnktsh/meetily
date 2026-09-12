'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { RecordingControls } from '@/components/RecordingControls';
import { TranscriptPanel } from '@/app/_components/TranscriptPanel';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import type { ModalType } from '@/hooks/useModalState';

/**
 * In-meeting capture surface. Rendered on the meeting workspace while a recording
 * is live so notes, transcript, and controls share the same screen as the notes.
 */
export function MeetingRecordingView({ onStopInitiated }: { onStopInitiated?: () => void }) {
  const recordingState = useRecordingState();
  const { selectedDevices } = useConfig();
  const { meetingTitle } = useTranscripts();

  const { handleRecordingStop, isStopping } = useRecordingStop(
    () => {},
    () => {},
  );

  const showModal = useCallback((_name: ModalType, _message?: string) => {}, []);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <TranscriptPanel
          isProcessingStop={recordingState.isProcessing}
          isStopping={isStopping}
          showModal={showModal}
        />
      </div>

      <div className="pointer-events-none fixed bottom-8 left-[272px] right-0 z-10">
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
    </div>
  );
}
