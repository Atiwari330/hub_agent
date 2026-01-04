'use client';

import { useState } from 'react';
import { DashboardTabs, type DashboardTab } from '@/components/dashboard/dashboard-tabs';
import { DailyDashboard } from '@/components/dashboard/daily-dashboard';
import { WeeklyDashboard } from '@/components/dashboard/weekly-dashboard';
import { QuarterlyDashboard } from '@/components/dashboard/quarterly-dashboard';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('daily');

  return (
    <div className="min-h-full flex flex-col">
      {/* Tab Navigation */}
      <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Dashboard Content */}
      <div className="flex-1">
        {activeTab === 'daily' && <DailyDashboard />}
        {activeTab === 'weekly' && <WeeklyDashboard />}
        {activeTab === 'quarterly' && <QuarterlyDashboard />}
      </div>
    </div>
  );
}
