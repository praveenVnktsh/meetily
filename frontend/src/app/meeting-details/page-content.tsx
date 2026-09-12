"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MeetingSummary, SummaryProcessResponse } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseSummaryContent, readSummaryMetadata } from '@/lib/summary-content';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { SummaryGeneratorButtonGroup } from '@/components/MeetingDetails/SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from '@/components/MeetingDetails/SummaryUpdaterButtonGroup';
import { SummaryLanguagePill } from '@/components/MeetingDetails/SummaryLanguagePill';
import { MeetingWorkspace, type NotesMode } from '@/components/MeetingDetails/MeetingWorkspace';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { MeetingAssistantPanel } from '@/components/MeetingDetails/MeetingAssistantPanel';
import { MeetingRawNotesEditor } from '@/components/MeetingDetails/MeetingRawNotesEditor';
import { LiveTranscriptPanel } from '@/components/MeetingDetails/LiveTranscriptPanel';
import { FloatingRecordingControls } from '@/components/MeetingDetails/FloatingRecordingControls';
import { LiveNotesPad } from '@/components/LiveNotesPad';
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
  const [notesMode, setNotesMode] = useState<NotesMode>(summaryData ? 'enhanced' : 'raw');
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

  // Persist an inline title edit and keep the sidebar in sync.
  const handleTitleChange = useCallback((nextTitle: string) => {
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === meetingData.meetingTitle) return;
    meetingData.updateMeetingTitle(trimmed);
    void invoke('api_save_meeting_title', { meetingId: meeting.id, title: trimmed }).catch((error) => {
      console.warn('Could not rename meeting:', error);
      toast.error('Could not rename the meeting');
    });
  }, [meeting.id, meetingData.meetingTitle, meetingData.updateMeetingTitle]);

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
  const canShowEnhanced = Boolean(meetingData.aiSummary) || summaryGeneration.summaryStatus === 'completed';
  const showAssistant = true;
  const effectiveNotesMode: NotesMode = notesMode === 'enhanced' && !canShowEnhanced ? 'raw' : notesMode;
  const peopleCount = new Set(
    meetingData.transcripts.map((t: any) => t.speaker_id ?? t.speaker).filter(Boolean)
  ).size;
  const statusBanner = phase === 'summarizing' || isSummaryActive ? (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-ink-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating summary…
    </span>
  ) : null;

  const summaryToolbarActions = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Summary options"
          aria-label="Summary options"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] space-y-3 p-3">
        <div className="flex items-center gap-2 text-[11px] text-ink-subtle">
          <span>{new Date(meeting.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          {peopleCount > 0 && (
            <>
              <span>·</span>
              <span>{peopleCount} {peopleCount === 1 ? 'person' : 'people'}</span>
            </>
          )}
        </div>
        <SummaryGeneratorButtonGroup
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={handleSaveModelConfig}
          onGenerateSummary={summaryGeneration.handleGenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          customPrompt={customPrompt}
          summaryStatus={summaryGeneration.summaryStatus}
          availableTemplates={templates.availableTemplates}
          selectedTemplate={templates.selectedTemplate}
          onTemplateSelect={templates.handleTemplateSelection}
          hasTranscripts={meetingData.transcripts.length > 0}
          hasSummary={canShowEnhanced}
          isModelConfigLoading={isModelConfigLoading}
          onOpenModelSettings={handleRegisterModalOpen}
          languageSlot={<SummaryLanguagePill meetingId={meeting.id} />}
        />
        {canShowEnhanced && (
          <SummaryUpdaterButtonGroup onCopy={copyOperations.handleCopySummary} />
        )}
      </PopoverContent>
    </Popover>
  );

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
      setNotesMode('enhanced');
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
        className="relative flex h-screen min-w-0 flex-col bg-surface-0"
      >
        <MeetingWorkspace
          title={meetingData.meetingTitle}
          createdAt={meeting.created_at}
          notesMode="raw"
          onNotesModeChange={() => {}}
          canShowEnhanced={false}
          summary={null}
          rawNotes={<LiveNotesPad bare />}
          transcript={<LiveTranscriptPanel />}
          assistant={
            <MeetingAssistantPanel
              meetingId={meeting.id}
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={handleSaveModelConfig}
              onNotesUpdated={(markdown) => meetingData.setAiSummary({ markdown })}
              onTranscriptUpdated={onRefetchTranscripts}
            />
          }
          showAssistant
          peopleCount={0}
          onTitleChange={handleTitleChange}
        />
        <FloatingRecordingControls onStopInitiated={() => setPhase('transcribing')} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex h-screen min-w-0 flex-col bg-[var(--surface-0)]"
    >
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <MeetingWorkspace
          title={meetingData.meetingTitle}
          createdAt={meeting.created_at}
          notesMode={effectiveNotesMode}
          onNotesModeChange={(mode) => {
            manuallySelectedViewMeetingIdsRef.current.add(meeting.id);
            setNotesMode(mode);
          }}
          canShowEnhanced={canShowEnhanced}
          showAssistant={showAssistant}
          peopleCount={peopleCount}
          statusBanner={statusBanner}
          toolbarActions={summaryToolbarActions}
          onTitleChange={handleTitleChange}
          onRegenerate={summaryGeneration.handleRegenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          isGenerating={isSummaryActive}
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
                setNotesMode('enhanced');
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
