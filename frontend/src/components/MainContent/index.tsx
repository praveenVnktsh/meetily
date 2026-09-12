'use client';

import React from 'react';
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, useShell } from '@/contexts/ShellContext';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { collapsed } = useShell();
  const offset = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <main
      className="min-w-0 flex-1 overflow-hidden transition-[margin] duration-200 ease-out"
      style={{ marginLeft: offset }}
    >
      <div className="min-w-0 w-full max-w-full overflow-hidden">
        {children}
      </div>
    </main>
  );
};

export default MainContent;
