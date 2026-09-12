"use client";

import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface SummaryUpdaterButtonGroupProps {
  onCopy: () => Promise<void>;
}

export function SummaryUpdaterButtonGroup({
  onCopy,
}: SummaryUpdaterButtonGroupProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        title="Copy Summary"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          onCopy();
        }}
        className="h-8 cursor-pointer rounded-full bg-[var(--surface-2)] px-3 text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
      >
        <Copy className="h-3.5 w-3.5" />
        <span>Copy</span>
      </Button>
    </div>
  );
}
