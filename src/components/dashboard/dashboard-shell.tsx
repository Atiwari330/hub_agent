'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './sidebar';

interface Owner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface QueueCounts {
  hygiene: { total: number; escalated: number };
  nextStep: { total: number; overdue: number };
  overdueTasks: { total: number; critical: number };
}

interface DashboardShellProps {
  owners: Owner[];
  lastSync: string | null;
  quarterLabel: string;
  quarterProgress: number;
  queueCounts: QueueCounts;
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

export function DashboardShell({
  owners,
  lastSync,
  quarterLabel,
  quarterProgress,
  queueCounts,
  children,
}: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) {
      setIsCollapsed(stored === 'true');
    }
  }, []);

  const handleCollapsedChange = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        owners={owners}
        lastSync={lastSync}
        quarterLabel={quarterLabel}
        quarterProgress={quarterProgress}
        queueCounts={queueCounts}
        onCollapsedChange={handleCollapsedChange}
      />
      <main className={`min-h-screen transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        {children}
      </main>
    </div>
  );
}
