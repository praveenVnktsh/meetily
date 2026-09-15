import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { storageService } from '@/services/storageService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/lib/recordingNotification';
import {
  getProviderCommands,
  hasDownloadingModel,
  type ModelWithStatus,
} from '@/lib/transcription-model-readiness';
import { toast } from 'sonner';
import {
  isLiveTranscriptionEnabled,
  LIVE_TRANSCRIPTION_STORAGE_KEY,
} from '@/lib/liveTranscription';
import { cachedDebugMode } from '@/lib/debugMode';

const TRANSCRIPTION_RUNTIME_START_ERROR_CODE = 'TRANSCRIPTION_RUNTIME_INITIALIZATION_FAILED';
const TRANSCRIPTION_RUNTIME_USER_MESSAGE = 'Speech recognition could not initialize. Restart Minutes. If the problem continues, repair or reinstall the app.';

const isTranscriptionRuntimeStartError = (error: unknown) =>
  String(error) === TRANSCRIPTION_RUNTIME_START_ERROR_CODE;

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

interface TranscriptConfig {
  provider?: string;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  // Synchronous latch: a rapid double-click re-enters handleRecordingStart
  // before any state update lands, so an async/state guard can't stop it.
  const isStartingRef = useRef(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive, setCurrentMeeting, refetchMeetings } = useSidebar();
  const { selectedDevices, betaFeatures } = useConfig();
  const { setStatus } = useRecordingState();
  const router = useRouter();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  const getTranscriptionProvider = useCallback(async (): Promise<string> => {
    try {
      const config = await invoke<TranscriptConfig | null>('api_get_transcript_config');
      return config?.provider || 'parakeet';
    } catch (error) {
      console.error('Failed to load transcription provider:', error);
      return 'parakeet';
    }
  }, []);

  // Check the selected local transcription provider, not a hardcoded engine.
  const checkTranscriptionModelReady = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);

      if (commands) {
        await invoke(commands.initialize);
        return await invoke<boolean>(commands.hasAvailableModels);
      }

      console.error(`Unsupported transcription provider: ${provider}`);
      return false;
    } catch (error) {
      console.error('Failed to check transcription model status:', error);
      return false;
    }
  }, [getTranscriptionProvider]);

  // Check download status for the selected local transcription provider.
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);
      if (!commands) return false;

      const models = await invoke<ModelWithStatus[]>(commands.getAvailableModels);
      return hasDownloadingModel(models);
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false; // Default to not downloading (will show error + modal)
    }
  }, [getTranscriptionProvider]);

  // The Rust recording command validates the same provider again before capture.
  const checkModelReady = checkTranscriptionModelReady;

  const configureLiveTranscription = useCallback(async () => {
    const enabled = isLiveTranscriptionEnabled(
      localStorage.getItem(LIVE_TRANSCRIPTION_STORAGE_KEY),
      betaFeatures.liveTranscription,
    );
    await invoke('set_live_transcription_enabled', { enabled });
    return enabled;
  }, [betaFeatures.liveTranscription]);

  // The recording folder is created by the backend during start. Grab it so the
  // meeting row can be linked to the audio from the very beginning, then open
  // the meeting workspace so recording, notes, and transcript share one screen.
  const openRecordingWorkspace = useCallback(async (title: string) => {
    let folderPath: string | null = null;
    for (let attempt = 0; attempt < 12 && !folderPath; attempt += 1) {
      folderPath = await invoke<string | null>('get_meeting_folder_path').catch(() => null);
      if (!folderPath) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    try {
      const { meeting_id } = await storageService.createMeeting(
        title,
        folderPath,
        cachedDebugMode(),
      );
      if (!meeting_id) return;
      sessionStorage.setItem('active_recording_meeting_id', meeting_id);
      setCurrentMeeting({ id: meeting_id, title });
      await refetchMeetings();
      router.push(`/meeting-details?id=${meeting_id}&recording=1`);
    } catch (error) {
      console.error('Failed to create the meeting workspace for recording:', error);
    }
  }, [refetchMeetings, router, setCurrentMeeting]);

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    if (isStartingRef.current) {
      console.log('handleRecordingStart ignored - start already in progress');
      return;
    }
    isStartingRef.current = true;
    try {
      console.log('handleRecordingStart called - checking selected transcription model status');

      const liveTranscriptionEnabled = await configureLiveTranscription();
      // Record-only mode must never be blocked by speech-model setup. The model
      // is needed at start only when live transcription was explicitly enabled.
      const modelReady = !liveTranscriptionEnabled || await checkModelReady();
      if (liveTranscriptionEnabled && !modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page');
        } else {
          toast.error('Transcription model not ready', {
            description: 'Please download a transcription model before recording.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page');
        }
        setStatus(RecordingStatus.IDLE);
        return;
      }

      console.log('Selected transcription model ready - setting up meeting title and state');

      const randomTitle = generateMeetingTitle();
      setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      setStatus(RecordingStatus.STARTING, 'Initializing recording...');

      // Start the actual backend recording
      console.log('Starting backend recording with meeting:', randomTitle);
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );
      console.log('Backend recording started successfully');

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      console.log('Setting isRecordingState to true');
      setIsRecording(true); // This will also update the sidebar via the useEffect
      clearTranscripts(); // Clear previous transcripts when starting new recording
      setIsMeetingActive(true);
      Analytics.trackButtonClick('start_recording', 'home_page');

      // Show recording notification if enabled
      await showRecordingNotification();

      // Open the meeting workspace so the whole session lives on one screen.
      await openRecordingWorkspace(randomTitle);
    } catch (error) {
      console.error('Failed to start recording:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      // A racing second start that lost to a live recording must not clobber
      // the running recording's state. The winning start is live, so reflect
      // RECORDING here — leaving STARTING latched would keep the Stop button
      // disabled forever, since it's gated on isStartingRecording.
      if (errorMsg.includes('already in progress')) {
        console.warn('Start rejected because recording is already active - leaving live recording state untouched');
        setStatus(RecordingStatus.RECORDING);
        Analytics.trackButtonClick('start_recording_error', 'home_page');
        return;
      }

      const isRuntimeError = isTranscriptionRuntimeStartError(error);
      if (errorMsg.includes('Recording start timed out')) {
        toast.error('Recording start timed out — please try again');
      }

      setStatus(RecordingStatus.ERROR, isRuntimeError
        ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
        : errorMsg);
      setIsRecording(false); // Reset state on error
      Analytics.trackButtonClick('start_recording_error', 'home_page');
      if (isRuntimeError) return;
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    } finally {
      isStartingRef.current = false;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkModelReady, checkIfModelDownloading, configureLiveTranscription, selectedDevices, showModal, setStatus, openRecordingWorkspace]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          console.log('Auto-starting recording from navigation...');
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          const liveTranscriptionEnabled = await configureLiveTranscription();
          const modelReady = !liveTranscriptionEnabled || await checkModelReady();
          if (liveTranscriptionEnabled && !modelReady) {
            const isDownloading = await checkIfModelDownloading();
            if (isDownloading) {
              toast.info('Model download in progress', {
                description: 'Please wait for the transcription model to finish downloading before recording.',
                duration: 5000,
              });
              Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_auto');
            } else {
              toast.error('Transcription model not ready', {
                description: 'Please download a transcription model before recording.',
                duration: 5000,
              });
              showModal?.('modelSelector', 'Transcription model setup required');
              Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_auto');
            }
            setStatus(RecordingStatus.IDLE);
            setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            setStatus(RecordingStatus.STARTING, 'Initializing recording...');

            console.log('Auto-starting backend recording with meeting:', generatedMeetingTitle);
            const result = await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              generatedMeetingTitle
            );
            console.log('Auto-start backend recording result:', result);

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            setMeetingTitle(generatedMeetingTitle);
            setIsRecording(true);
            clearTranscripts();
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_recording', 'sidebar_auto');

            // Show recording notification if enabled
            await showRecordingNotification();

            // Open the meeting workspace so the whole session lives on one screen.
            await openRecordingWorkspace(generatedMeetingTitle);
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('already in progress')) {
              // Benign race — another start won and is live; skip ERROR/alert.
              setStatus(RecordingStatus.RECORDING);
            } else {
              const isRuntimeError = isTranscriptionRuntimeStartError(error);
              setStatus(RecordingStatus.ERROR, isRuntimeError
                ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
                : errorMsg);
              if (!isRuntimeError) {
                alert(`Failed to start recording.\n\n${errorMsg}`);
              }
            }
            Analytics.trackButtonClick('start_recording_error', 'sidebar_auto');
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkModelReady,
    checkIfModelDownloading,
    configureLiveTranscription,
    showModal,
    setStatus,
    openRecordingWorkspace,
  ]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        console.log('Recording already in progress, ignoring direct start event');
        return;
      }

      console.log('Direct start from sidebar - checking selected transcription model status');
      setIsAutoStarting(true);

      const liveTranscriptionEnabled = await configureLiveTranscription();
      const modelReady = !liveTranscriptionEnabled || await checkModelReady();
      if (liveTranscriptionEnabled && !modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (isDownloading) {
          toast.info('Model download in progress', {
            description: 'Please wait for the transcription model to finish downloading before recording.',
            duration: 5000,
          });
          Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_direct');
        } else {
          toast.error('Transcription model not ready', {
            description: 'Please download a transcription model before recording.',
            duration: 5000,
          });
          showModal?.('modelSelector', 'Transcription model setup required');
          Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_direct');
        }
        setStatus(RecordingStatus.IDLE);
        setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        setStatus(RecordingStatus.STARTING, 'Initializing recording...');

        console.log('Starting backend recording with meeting:', generatedMeetingTitle);
        const result = await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          generatedMeetingTitle
        );
        console.log('Backend recording result:', result);

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        setMeetingTitle(generatedMeetingTitle);
        setIsRecording(true);
        clearTranscripts();
        setIsMeetingActive(true);
        Analytics.trackButtonClick('start_recording', 'sidebar_direct');

        // Show recording notification if enabled
        await showRecordingNotification();

        // Open the meeting workspace so the whole session lives on one screen.
        await openRecordingWorkspace(generatedMeetingTitle);
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already in progress')) {
          // Benign race — another start won and is live; skip ERROR/alert.
          setStatus(RecordingStatus.RECORDING);
        } else {
          const isRuntimeError = isTranscriptionRuntimeStartError(error);
          setStatus(RecordingStatus.ERROR, isRuntimeError
            ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
            : errorMsg);
          if (!isRuntimeError) {
            alert(`Failed to start recording.\n\n${errorMsg}`);
          }
        }
        Analytics.trackButtonClick('start_recording_error', 'sidebar_direct');
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkModelReady,
    checkIfModelDownloading,
    configureLiveTranscription,
    showModal,
    setStatus,
    openRecordingWorkspace,
  ]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
