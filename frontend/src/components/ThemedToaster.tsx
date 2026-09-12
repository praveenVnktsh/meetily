'use client';

import { Toaster } from 'sonner';
import 'sonner/dist/styles.css';
import { useShell } from '@/contexts/ShellContext';

export function ThemedToaster() {
  const { theme } = useShell();
  return <Toaster position="bottom-center" richColors closeButton theme={theme} />;
}
