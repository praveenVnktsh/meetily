"use client";
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { MeetingSummary, SummaryProcessResponse } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { parseSummaryContent, readSummaryMetadata } from '@/lib/summary-content';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { MeetingDetailsSplitView, type MeetingRightView } from '@/components/MeetingDetails/MeetingDetailsSplitView';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { MeetingAssistantPanel } from '@/components/MeetingDetails/MeetingAssistantPanel';
import { MeetingRawNotesEditor } from '@/components/MeetingDetails/MeetingRawNotesEditor';
import { MeetingRecordingView } from '@/components/MeetingDetails/MeetingRecordingView';
import { useRecordingState } from '@/contexts/RecordingStateContext';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';

type WorkspacePhase = 'transcribing' | 'summarizing' | 'ready';

export default function PageContent({
  meeting,
  summaryData,
  initialSummary,
  arrivedRecording = false,
  arrivedTranscribing = false,
  expectSummary = false,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: MeetingSummary | null;
  initialSummary: SummaryProcessResponse | null;
  arrivedRecording?: boolean;
  arrivedTranscribing?: boolean;
  expectSummary?: boolean;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const isRecording = false;
  const [rightView, setRightView] = useState<MeetingRightView>(summaryData ? 'summary' : 'transcript');
  const [phase, setPhase] = useState<WorkspacePhase>(() =>
    arrivedRecording || arrivedTranscribing ? 'transcribing' : expectSummary ? 'summarizing' : 'ready'
  );
  const [summaryWatchExhausted, setSummaryWatchExhausted] = useState(false);
  const recordingState = useRecordingState();
  const isRecordingThisMeeting = arrivedRecording && recordingState.isRecording;

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const autoSwitchedSummaryMeetingIdsRef = useRef(new Set<string>());
  const manuallySelectedViewMeetingIdsRef = useRef(new Set<string>());
  const autoGenerationStartedMeetingIdRef = useRef<string | null>(null);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig, isModelConfigLoading } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Keep the latest title updater without restarting the summary watcher below.
  const updateMeetingTitleRef = useRef(meetingData.updateMeetingTitle);
  updateMeetingTitleRef.current = meetingData.updateMeetingTitle;

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  const summaryGeneration = useSummaryGeneration({
    initialSummary,
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // The workspace reveals the AI chat only once transcription and (when expected)
  // the summary have finished. Until then we surface quiet progress instead.
  useEffect(() => {
    if (phase !== 'transcribing') return;
    if (meetingData.transcripts.length > 0) {
      setPhase(expectSummary ? 'summarizing' : 'ready');
    }
  }, [phase, meetingData.transcripts.length, expectSummary]);

  useEffect(() => {
    const advanceFromTranscribing = () => {
      setPhase((current) =>
        current === 'transcribing' ? (expectSummary ? 'summarizing' : 'ready') : current
      );
    };
    const handleTranscriptionComplete = (event: Event) => {
      const completedMeetingId = (event as CustomEvent<{ meetingId: string }>).detail?.meetingId;
      if (completedMeetingId && completedMeetingId !== meeting.id) return;
      advanceFromTranscribing();
    };
    window.addEventListener('meetily:transcription-complete', handleTranscriptionComplete);
    window.addEventListener('transcription-queue-error', advanceFromTranscribing);
    return () => {
      window.removeEventListener('meetily:transcription-complete', handleTranscriptionComplete);
      window.removeEventListener('transcription-queue-error', advanceFromTranscribing);
    };
  }, [meeting.id, expectSummary]);

  // A recording that finished inside this workspace hands back its post-processing
  // state here, so the same screen can show transcribing/summary progress.
  useEffect(() => {
    const handleFinalized = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId?: string; transcribing?: boolean }>).detail;
      if (detail?.meetingId && detail.meetingId !== meeting.id) return;
      setPhase(detail?.transcribing ? 'transcribing' : (expectSummary ? 'summarizing' : 'ready'));
      void onRefetchTranscripts?.();
    };
    window.addEventListener('meetily:recording-finalized', handleFinalized);
    return () => window.removeEventListener('meetily:recording-finalized', handleFinalized);
  }, [meeting.id, expectSummary, onRefetchTranscripts]);

  // Background summary generation can be started outside this screen, so watch the
  // stored summary until it lands and hand it to the notes panel.
  useEffect(() => {
    if (!expectSummary || meetingData.aiSummary) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      try {
        const response = await invoke<SummaryProcessResponse>('api_get_summary', { meetingId: meeting.id });
        if (cancelled) return;
        const summary = parseSummaryContent(response.data);
        if (summary) {
          // The summary also names the meeting; adopt it so the header and
          // sidebar reflect the AI-generated title.
          const meetingName = readSummaryMetadata(response.data)?.meetingName
            ?? response.meetingName
            ?? null;
          if (meetingName) updateMeetingTitleRef.current(meetingName);
          meetingData.setAiSummary(summary);
          return;
        }
      } catch (error) {
        console.warn('Could not check summary status:', error);
      }
      if (cancelled) return;
      if (attempts++ < 150) {
        setTimeout(tick, 2000);
      } else {
        setSummaryWatchExhausted(true);
      }
    };
    const timer = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expectSummary, meeting.id, meetingData.aiSummary, meetingData.setAiSummary]);

  useEffect(() => {
    if (
      meetingData.aiSummary
      || summaryGeneration.summaryStatus === 'completed'
      || summaryGeneration.summaryStatus === 'error'
      || summaryWatchExhausted
    ) {
      setPhase('ready');
    }
  }, [meetingData.aiSummary, summaryGeneration.summaryStatus, summaryWatchExhausted]);

  const isSummaryActive = summaryGeneration.summaryStatus === 'processing'
    || summaryGeneration.summaryStatus === 'summarizing'
    || summaryGeneration.summaryStatus === 'regenerating';
  const showSummary = Boolean(meetingData.aiSummary) || summaryGeneration.summaryStatus === 'completed';
  const showAssistant = phase === 'ready';
  const effectiveRightView: MeetingRightView = rightView === 'summary' && !showSummary
    ? 'transcript'
    : rightView === 'assistant' && !showAssistant
      ? 'transcript'
      : rightView;
  const statusBanner = phase === 'summarizing' || isSummaryActive ? (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#efede7] px-3 py-1.5 text-[11px] font-medium text-[#5d5a53]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating summary…
    </span>
  ) : null;

  // Track page view
  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  useEffect(() => {
    if (
      (meetingData.aiSummary || summaryGeneration.summaryStatus === 'completed')
      && !autoSwitchedSummaryMeetingIdsRef.current.has(meeting.id)
      && !manuallySelectedViewMeetingIdsRef.current.has(meeting.id)
    ) {
      autoSwitchedSummaryMeetingIdsRef.current.add(meeting.id);
      setRightView('summary');
    }
  }, [meeting.id, meetingData.aiSummary, summaryGeneration.summaryStatus]);

  // Auto-generate only after the model configuration has settled.
  useEffect(() => {
    if (
      !shouldAutoGenerate
      || summaryGeneration.summaryStatus !== 'idle'
      || isModelConfigLoading
      || meetingData.transcripts.length === 0
      || autoGenerationStartedMeetingIdRef.current === meeting.id
    ) {
      return;
    }

    autoGenerationStartedMeetingIdRef.current = meeting.id;
    console.log(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
    onAutoGenerateComplete?.();
    void summaryGeneration.handleGenerateSummary('');
  }, [
    shouldAutoGenerate,
    meeting.id,
    meetingData.transcripts.length,
    isModelConfigLoading,
    modelConfig.provider,
    modelConfig.model,
    summaryGeneration.handleGenerateSummary,
    summaryGeneration.summaryStatus,
    onAutoGenerateComplete,
  ]);

  if (isRecordingThisMeeting) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex h-screen min-w-0 flex-col bg-[#fbfaf7]"
      >
        <MeetingRecordingView onStopInitiated={() => setPhase('transcribing')} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex h-screen min-w-0 flex-col bg-[#fbfaf7]"
    >
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <MeetingDetailsSplitView
          title={meetingData.meetingTitle}
          createdAt={meeting.created_at}
          rightView={effectiveRightView}
          onRightViewChange={(view) => {
            manuallySelectedViewMeetingIdsRef.current.add(meeting.id);
            setRightView(view);
          }}
          showSummary={showSummary}
          showAssistant={showAssistant}
          statusBanner={statusBanner}
          transcript={
            <TranscriptPanel
              transcripts={meetingData.transcripts}
              onCopyTranscript={copyOperations.handleCopyTranscript}
              onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
              isRecording={isRecording}
              isTranscribing={phase === 'transcribing'}
              locked={phase === 'summarizing' || isSummaryActive}
              disableAutoScroll={true}
              usePagination={true}
              segments={segments}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              totalCount={totalCount}
              loadedCount={loadedCount}
              onLoadMore={onLoadMore}
              meetingId={meeting.id}
              meetingFolderPath={meeting.folder_path}
              onRefetchTranscripts={onRefetchTranscripts}
            />
          }
          rawNotes={<MeetingRawNotesEditor meetingId={meeting.id} />}
          assistant={
            <MeetingAssistantPanel
              meetingId={meeting.id}
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={handleSaveModelConfig}
              onNotesUpdated={(markdown) => {
                meetingData.setAiSummary({ markdown });
                setRightView('summary');
              }}
              onTranscriptUpdated={onRefetchTranscripts}
            />
          }
          summary={
            <SummaryPanel
              meeting={meeting}
              meetingTitle={meetingData.meetingTitle}
              summaryRef={meetingData.blockNoteSummaryRef}
              isSaving={meetingData.isSaving}
              isSummaryDirty={meetingData.isSummaryDirty}
              onCopySummary={copyOperations.handleCopySummary}
              aiSummary={meetingData.aiSummary}
              summaryStatus={summaryGeneration.summaryStatus}
              transcripts={meetingData.transcripts}
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={handleSaveModelConfig}
              onGenerateSummary={summaryGeneration.handleGenerateSummary}
              onStopGeneration={summaryGeneration.handleStopGeneration}
              customPrompt={customPrompt}
              onSaveSummary={meetingData.handleSaveSummary}
              onSummaryChange={meetingData.handleSummaryChange}
              onDirtyChange={meetingData.setIsSummaryDirty}
              summaryError={summaryGeneration.summaryError}
              onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
              getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
              availableTemplates={templates.availableTemplates}
              selectedTemplate={templates.selectedTemplate}
              onTemplateSelect={templates.handleTemplateSelection}
              isModelConfigLoading={isModelConfigLoading}
              onOpenModelSettings={handleRegisterModalOpen}
            />
          }
        />
      </div>
    </motion.div>
  );
}
