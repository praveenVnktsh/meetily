"use client";

import { ModelConfig, ModelSettingsModal } from '@/components/ModelSettingsModal';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sparkles, Settings, Loader2, FileText, Check, Square } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { useState, useEffect, ReactNode } from 'react';

interface SummaryGeneratorButtonGroupProps {
  languageSlot?: ReactNode;
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  hasTranscripts?: boolean;
  hasSummary?: boolean;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
}

export function SummaryGeneratorButtonGroup({
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  hasTranscripts = true,
  hasSummary = false,
  isModelConfigLoading = false,
  onOpenModelSettings,
  languageSlot
}: SummaryGeneratorButtonGroupProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Expose the function to open the modal via callback registration
  useEffect(() => {
    if (onOpenModelSettings) {
      // Register our open dialog function with the parent by calling the callback
      // This allows the parent to store a reference to this function
      const openDialog = () => {
        console.log('📱 Opening model settings dialog via callback');
        setSettingsDialogOpen(true);
      };

      // Call the parent's callback with our open function
      // Note: This assumes onOpenModelSettings accepts a function parameter
      // We'll need to adjust the signature
      onOpenModelSettings(openDialog);
    }
  }, [onOpenModelSettings]);

  if (!hasTranscripts) {
    return null;
  }

  const isGenerating = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const selectedTemplateName = availableTemplates.find((template) => template.id === selectedTemplate)?.name ?? 'Template';

  return (
    <div className="grid w-full grid-cols-2 gap-1.5 @[42rem]:flex @[42rem]:w-auto @[42rem]:items-center">
      {/* Generate Summary or Stop button */}
      {isGenerating ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-1.5 rounded-full bg-[#f4dfda] px-3 text-[#8a4138] hover:bg-[#edd1ca] @[42rem]:w-auto"
          onClick={() => {
            Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
            onStopGeneration();
          }}
          title="Stop summary generation"
        >
          <Square size={18} fill="currentColor" />
          <span className="hidden @[24rem]:inline">Stop</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-1.5 rounded-full bg-[#272622] px-3 text-white hover:bg-[#3b3934] hover:text-white @[42rem]:w-auto"
          onClick={() => {
            Analytics.trackButtonClick('generate_summary', 'meeting_details');
            void onGenerateSummary(customPrompt);
          }}
          disabled={isModelConfigLoading}
          title={
            isModelConfigLoading
              ? 'Loading model configuration...'
              : hasSummary ? 'Regenerate AI Summary' : 'Generate AI Summary'
          }
        >
          {isModelConfigLoading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              <span>Working…</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>{hasSummary ? 'Regenerate' : 'Generate'}</span>
            </>
          )}
        </Button>
      )}

      {languageSlot}

      {/* Settings button */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            title="Summary Settings"
            className="h-8 w-full justify-start gap-1.5 rounded-full bg-[#efede7] px-3 text-[#5d5a53] hover:bg-[#e7e4dd] @[42rem]:w-auto @[42rem]:max-w-44"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="max-w-32 truncate">{modelConfig.model || 'Choose model'}</span>
          </Button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
        >
          <VisuallyHidden>
            <DialogTitle>Model Settings</DialogTitle>
          </VisuallyHidden>
          <ModelSettingsModal
            onSave={async (config) => {
              await onSaveModelConfig(config);
              setSettingsDialogOpen(false);
            }}
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            skipInitialFetch={true}
            layout="dialog"
          />
        </DialogContent>
      </Dialog>

      {/* Template selector dropdown */}
      {availableTemplates.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              title="Select summary template"
              className="h-8 w-full justify-start gap-1.5 rounded-full bg-[#efede7] px-3 text-[#5d5a53] hover:bg-[#e7e4dd] @[42rem]:w-auto @[42rem]:max-w-40"
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="max-w-28 truncate">{selectedTemplateName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {availableTemplates.map((template) => (
              <DropdownMenuItem
                key={template.id}
                onClick={() => onTemplateSelect(template.id, template.name)}
                title={template.description}
                className="flex items-center justify-between gap-2"
              >
                <span>{template.name}</span>
                {selectedTemplate === template.id && (
                  <Check className="h-4 w-4 text-green-600" />
                )}
              </DropdownMenuItem>
            ))}

          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
