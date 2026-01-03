'use client';

import { useState } from 'react';
import { DashboardTabs, type DashboardTab } from '@/components/dashboard/dashboard-tabs';
import { DailyDashboard } from '@/components/dashboard/daily-dashboard';
import { QuarterlyDashboard } from '@/components/dashboard/quarterly-dashboard';

// Placeholder for Weekly (will be implemented next)
function WeeklyDashboard() {
  return (
    <div className="p-8">
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
        <div className="text-4xl mb-4">&#128197;</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Weekly Tactical Dashboard</h3>
        <p className="text-gray-500 max-w-md mx-auto">
          Week-over-week pipeline movement, AE comparison matrix, stage velocity analysis, and
          sentiment distribution. Coming next.
        </p>
      </div>
    </div>
  );
}

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
