'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Block, PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { blocksToMarkdownSafely } from '@/lib/blocknote-markdown';
import { createLiveNote, type LiveNote, type LiveNotesDocument } from '@/lib/liveNotes';
import '@blocknote/shadcn/style.css';
import '@blocknote/core/fonts/inter.css';

function textFromBlock(block: Block): string {
  const content = block.content as unknown;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'text' in item) return String(item.text ?? '');
    return '';
  }).join('');
}

function initialBlocks(document: LiveNotesDocument): PartialBlock[] {
  if (Array.isArray(document.editorBlocks) && document.editorBlocks.length > 0) {
    return document.editorBlocks as PartialBlock[];
  }
  const notes = document.notes.filter((note) => note.text.trim());
  if (notes.length > 0) {
    return notes.map((note) => ({
      id: note.id,
      type: 'bulletListItem',
      content: note.text,
    }));
  }
  return [{ type: 'bulletListItem', content: '' }];
}

export function BlockNotesEditor({
  document,
  onChange,
  editable = true,
}: {
  document: LiveNotesDocument;
  onChange?: (document: LiveNotesDocument) => void;
  editable?: boolean;
}) {
  const startingBlocks = useMemo(() => initialBlocks(document), []); // document is the mount snapshot
  const timestamps = useRef(new Map(document.notes.map((note) => [note.id, note.timestampSeconds])));
  const latestDocument = useRef(document);
  latestDocument.current = document;
  const changeVersion = useRef(0);
  const editor = useCreateBlockNote({
    initialContent: startingBlocks,
    placeholders: {
      default: 'Start typing your notes…',
      emptyDocument: 'Start typing your notes…',
    },
  });

  useEffect(() => {
    if (!onChange || !editable) return;
    return editor.onChange(() => {
      const version = ++changeVersion.current;
      const blocks = editor.document;
      void blocksToMarkdownSafely(editor, blocks, {
        source: 'BlockNotesEditor',
        fallbackMarkdown: latestDocument.current.rawMarkdown,
      }).then((result) => {
        if (version !== changeVersion.current) return;
        const nowSeconds = Math.max(0, (Date.now() - latestDocument.current.meetingStartedAtMs) / 1000);
        const previousById = new Map(latestDocument.current.notes.map((note) => [note.id, note]));
        const notes: LiveNote[] = blocks.map((block) => {
          const previous = previousById.get(block.id);
          const timestampSeconds = previous?.timestampSeconds ?? timestamps.current.get(block.id) ?? nowSeconds;
          timestamps.current.set(block.id, timestampSeconds);
          return {
            id: block.id,
            timestampSeconds,
            text: textFromBlock(block),
            important: previous?.important ?? false,
          };
        });
        onChange({
          ...latestDocument.current,
          version: 2,
          updatedAt: new Date().toISOString(),
          notes,
          rawMarkdown: result.markdown,
          editorBlocks: blocks,
        });
      });
    });
  }, [editable, editor, onChange]);

  return (
    <div className="raw-notes-editor min-h-full text-[15px] text-[#272622]">
      <BlockNoteView editor={editor} editable={editable} theme="light" />
    </div>
  );
}
