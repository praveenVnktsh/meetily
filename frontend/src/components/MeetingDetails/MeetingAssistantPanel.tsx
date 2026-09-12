'use client';

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowUp, Bot, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface AssistantResponse {
  message: ChatMessage;
  notesMarkdown?: string | null;
  transcriptEditsApplied: number;
}

const STARTERS = [
  'What decisions did we make?',
  'Turn this into clear action items',
  'Make the notes more concise',
];

export function MeetingAssistantPanel({
  meetingId,
  onNotesUpdated,
  onTranscriptUpdated,
}: {
  meetingId: string;
  onNotesUpdated: (markdown: string) => void;
  onTranscriptUpdated?: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ChatMessage[]>('get_meeting_chat', { meetingId })
      .then((result) => { if (!cancelled) setMessages(result); })
      .catch((error) => console.warn('Could not load meeting chat:', error));
    return () => { cancelled = true; };
  }, [meetingId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || isSending) return;
    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setInput('');
    setIsSending(true);
    try {
      const response = await invoke<AssistantResponse>('chat_with_meeting', { meetingId, message: content });
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), optimistic, response.message]);
      if (response.notesMarkdown) onNotesUpdated(response.notesMarkdown);
      if (response.transcriptEditsApplied > 0) {
        await onTranscriptUpdated?.();
        toast.success(`Updated ${response.transcriptEditsApplied} transcript segment${response.transcriptEditsApplied === 1 ? '' : 's'}`);
      } else if (response.notesMarkdown) {
        toast.success('Enhanced notes updated');
      }
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setInput(content);
      toast.error('The meeting assistant could not respond', { description: String(error) });
    } finally {
      setIsSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#fbfaf7]">
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-[760px] space-y-6">
          {messages.length === 0 && (
            <div className="py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e7eee5] text-[#55735c]">
                <Bot className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-[#272622]">Ask about this meeting</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77736a]">The assistant can use the transcript, enhanced notes, and your raw notes—and update the workspace when you ask.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {STARTERS.map((starter) => (
                  <button key={starter} type="button" onClick={() => setInput(starter)} className="rounded-full border border-[#dedbd2] bg-white px-3 py-1.5 text-xs text-[#5d5a53] hover:border-[#aaa69b]">
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={message.role === 'user' ? 'max-w-[78%] rounded-2xl rounded-br-md bg-[#272622] px-4 py-3 text-sm leading-6 text-white' : 'prose prose-sm max-w-[88%] text-[#3d3b36]'}>
                {message.role === 'assistant'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  : message.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex items-center gap-2 text-sm text-[#8b887f]">
              <Sparkles className="h-4 w-4 animate-pulse" /> Working across the meeting…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <form onSubmit={send} className="border-t border-[#e5e2da] bg-[#fbfaf7] px-8 pb-7 pt-4">
        <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl border border-[#d8d5cc] bg-white p-2 shadow-[0_8px_30px_rgba(45,43,37,0.08)]">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask, summarize, or tell AI what to change…"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-[#272622] outline-none placeholder:text-[#aaa69b]"
          />
          <button type="submit" disabled={!input.trim() || isSending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#272622] text-white disabled:bg-[#c9c6bd]" aria-label="Send message">
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[#aaa69b]">Transcript edits are revision-backed. AI can make mistakes.</p>
      </form>
    </div>
  );
}
