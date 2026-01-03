'use client';

import { useState } from 'react';

export type DashboardTab = 'daily' | 'weekly' | 'quarterly';

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const TABS: { id: DashboardTab; label: string; description: string }[] = [
  { id: 'daily', label: 'Today', description: "What needs attention now" },
  { id: 'weekly', label: 'Weekly', description: "The week in review" },
  { id: 'quarterly', label: 'Quarterly', description: "Are we on track?" },
];

export function DashboardTabs({ activeTab, onTabChange }: DashboardTabsProps) {
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Mission Control</h1>
        <p className="text-sm text-gray-500 mb-4">RevOps command center - exceptions surface, health stays quiet</p>
      </div>
      <nav className="flex px-8 gap-1" aria-label="Dashboard tabs">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative px-4 py-3 text-sm font-medium rounded-t-lg transition-colors
                ${isActive
                  ? 'bg-gray-50 text-indigo-600 border-t border-l border-r border-gray-200'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }
              `}
              aria-current={isActive ? 'page' : undefined}
            >
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
