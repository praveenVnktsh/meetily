import { useCallback, RefObject } from 'react';
import { MeetingSummary, Transcript } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { hasVisibleSummaryContent } from '@/lib/summary-content';

interface UseCopyOperationsProps {
  meeting: any;
  transcripts: Transcript[];
  meetingTitle: string;
  aiSummary: MeetingSummary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef>;
}

export function useCopyOperations({
  meeting,
  transcripts,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
}: UseCopyOperationsProps) {

  // Helper function to fetch ALL transcripts for copying (not just paginated data)
  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    try {
      console.log('📊 Fetching all transcripts for copying:', meetingId);

      // First, get total count by fetching first page
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;
      console.log(`📊 Total transcripts in database: ${totalCount}`);

      if (totalCount === 0) {
        return [];
      }

      // Fetch all transcripts in one call
      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      console.log(`✅ Fetched ${allData.transcripts.length} transcripts from database for copying`);
      return allData.transcripts;
    } catch (error) {
      console.error('❌ Error fetching all transcripts:', error);
      toast.error('Failed to fetch transcripts for copying');
      return [];
    }
  }, []);

  // Copy transcript to clipboard
  const handleCopyTranscript = useCallback(async () => {
    // CHANGE: Fetch ALL transcripts from database, not from pagination state
    console.log('📊 Fetching all transcripts for copying...');
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      const error_msg = 'No transcripts available to copy';
      console.log(error_msg);
      toast.error(error_msg);
      return;
    }

    console.log(`✅ Copying ${allTranscripts.length} transcripts to clipboard`);

    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined, fallbackTimestamp: string): string => {
      if (seconds === undefined) {
        // For old transcripts without audio_start_time, use wall-clock time
        return fallbackTimestamp;
      }
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    const header = `# Transcript of the Meeting: ${meeting.id} - ${meetingTitle ?? meeting.title}\n\n`;
    const date = `## Date: ${new Date(meeting.created_at).toLocaleDateString()}\n\n`;
    const fullTranscript = allTranscripts
      .map(t => `${formatTime(t.audio_start_time, t.timestamp)}${t.speaker ? ` [${t.speaker === 'mic' ? 'You' : t.speaker === 'system' ? 'Others' : t.speaker}]` : ''} ${t.text}  `)
      .join('\n');

    await navigator.clipboard.writeText(header + date + fullTranscript);
    toast.success("Transcript copied to clipboard");

    // Track copy analytics
    const wordCount = allTranscripts
      .map(t => t.text.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);

    await Analytics.trackCopy('transcript', {
      meeting_id: meeting.id,
      transcript_length: allTranscripts.length.toString(),
      word_count: wordCount.toString()
    });
  }, [meeting, meetingTitle, fetchAllTranscripts]);

  // Build the summary as Markdown, preferring the live editor content.
  const buildSummaryMarkdown = useCallback(async (): Promise<string> => {
    if (!hasVisibleSummaryContent(aiSummary)) return '';

    try {
      let summaryMarkdown = '';

      // Try to get markdown from BlockNote editor first
      if (blockNoteSummaryRef.current?.getMarkdown) {
        summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
      }

      // Fallback: Check if aiSummary has markdown property
      if (!summaryMarkdown && aiSummary && typeof aiSummary.markdown === 'string') {
        summaryMarkdown = aiSummary.markdown;
      }

      // Fallback: Check for legacy format
      if (!summaryMarkdown && aiSummary) {
        summaryMarkdown = Object.entries(aiSummary)
          .filter(([key]) => key !== 'markdown' && key !== 'summary_json' && key !== '_section_order' && key !== 'MeetingName')
          .map(([, section]) => {
            if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
              const typed = section as { title: string; blocks: Array<{ content: string }> };
              const sectionTitle = `## ${typed.title}\n\n`;
              const sectionContent = typed.blocks.map((block) => `- ${block.content}`).join('\n');
              return sectionTitle + sectionContent;
            }
            return '';
          })
          .filter((section) => section.trim())
          .join('\n\n');
      }

      return summaryMarkdown.trim();
    } catch (error) {
      console.error('❌ Failed to build summary markdown:', error);
      return '';
    }
  }, [aiSummary, blockNoteSummaryRef]);

  // Copy summary to clipboard
  const handleCopySummary = useCallback(async () => {
    const summaryMarkdown = await buildSummaryMarkdown();
    if (!summaryMarkdown) {
      toast.error('No summary content available to copy');
      return;
    }

    try {
      const header = `# Meeting Summary: ${meetingTitle}\n\n`;
      const metadata = `**Meeting ID:** ${meeting.id}\n**Date:** ${new Date(meeting.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n**Copied on:** ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n\n---\n\n`;

      await navigator.clipboard.writeText(header + metadata + summaryMarkdown);
      toast.success("Summary copied to clipboard");

      await Analytics.trackCopy('summary', {
        meeting_id: meeting.id,
        has_markdown: (!!aiSummary && 'markdown' in aiSummary).toString()
      });
    } catch (error) {
      console.error('❌ Failed to copy summary:', error);
      toast.error("Failed to copy summary");
    }
  }, [buildSummaryMarkdown, aiSummary, meetingTitle, meeting]);

  // Export the meeting (title, summary, transcript) as a Markdown file.
  const handleExportMarkdown = useCallback(async () => {
    try {
      const [summaryMarkdown, allTranscripts] = await Promise.all([
        buildSummaryMarkdown(),
        fetchAllTranscripts(meeting.id),
      ]);

      if (!summaryMarkdown && allTranscripts.length === 0) {
        toast.error('Nothing to export yet');
        return;
      }

      const lines: string[] = [`# ${meetingTitle || meeting.title || 'Untitled meeting'}`, ''];
      if (meeting.created_at) {
        lines.push(`_${new Date(meeting.created_at).toLocaleString()}_`, '');
      }

      if (summaryMarkdown) {
        lines.push('## Summary', '', summaryMarkdown, '');
      }

      if (allTranscripts.length > 0) {
        const formatTime = (seconds: number | undefined, fallback: string): string => {
          if (seconds === undefined) return fallback;
          const totalSecs = Math.floor(seconds);
          const mins = Math.floor(totalSecs / 60);
          const secs = totalSecs % 60;
          return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
        };

        lines.push('## Transcript', '');
        for (const segment of allTranscripts) {
          const speaker = segment.speaker
            ? ` **${segment.speaker === 'mic' ? 'You' : segment.speaker === 'system' ? 'Others' : segment.speaker}**`
            : '';
          lines.push(`- ${formatTime(segment.audio_start_time, segment.timestamp)}${speaker} ${segment.text}`);
        }
        lines.push('');
      }

      const safeTitle = (meetingTitle || meeting.title || 'meeting')
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'meeting';
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${safeTitle}-${stamp}.md`;

      const path = await invokeTauri('save_text_export', { fileName, contents: lines.join('\n') }) as string;
      toast.success('Meeting exported', { description: path });

      await Analytics.trackCopy('summary', {
        meeting_id: meeting.id,
        has_markdown: (!!summaryMarkdown).toString()
      });
    } catch (error) {
      console.error('❌ Failed to export meeting:', error);
      toast.error('Failed to export meeting');
    }
  }, [meeting, meetingTitle, buildSummaryMarkdown, fetchAllTranscripts]);

  return {
    handleCopyTranscript,
    handleCopySummary,
    handleExportMarkdown,
  };
}
