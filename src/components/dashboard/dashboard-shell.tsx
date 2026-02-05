'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import type { UserWithPermissions } from '@/lib/auth/types';

interface Owner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface DashboardShellProps {
  owners: Owner[];
  lastSync: string | null;
  quarterLabel: string;
  quarterProgress: number;
  children: React.ReactNode;
  user: UserWithPermissions;
}

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

export function DashboardShell({
  owners,
  lastSync,
  quarterLabel,
  quarterProgress,
  children,
  user,
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
        onCollapsedChange={handleCollapsedChange}
        user={user}
      />
      <main className={`min-h-screen transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        {children}
      </main>
    </div>
  );
}
