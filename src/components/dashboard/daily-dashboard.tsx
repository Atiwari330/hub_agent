'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { AEStatusBar, type AEStatus } from './ae-status-bar';
import { ExceptionCard, type ExceptionDeal, type ExceptionType } from './exception-card';
import { AIInsightsButton } from './ai-insights-button';

interface ExceptionCounts {
  overdueNextSteps: number;
  pastCloseDates: number;
  activityDrought: number;
  noNextStep: number;
  staleStage: number;
  highValueAtRisk: number;
}

interface DailySummaryData {
  date: string;
  summary: {
    totalActiveDeals: number;
    totalExceptions: number;
    counts: ExceptionCounts;
  };
  hasCriticalAlert: boolean;
  criticalAlertMessage: string | null;
  aeStatuses: AEStatus[];
  exceptionDeals: ExceptionDeal[];
}

function ExceptionCountCard({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: 'red' | 'amber' | 'gray';
}) {
  const colors = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-3xl font-semibold">{count}</div>
      <div className="text-sm mt-1">{label}</div>
    </div>
  );
}

function formatDateHeader(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function DailyDashboard() {
  const [data, setData] = useState<DailySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/dashboard/daily-summary');
        if (!response.ok) {
          throw new Error('Failed to fetch daily summary');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-gray-200 rounded-xl"></div>
            <div className="h-24 bg-gray-200 rounded-xl"></div>
            <div className="h-24 bg-gray-200 rounded-xl"></div>
          </div>
          <div className="h-20 bg-gray-200 rounded-xl"></div>
          <div className="space-y-3">
            <div className="h-16 bg-gray-200 rounded-lg"></div>
            <div className="h-16 bg-gray-200 rounded-lg"></div>
            <div className="h-16 bg-gray-200 rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <h3 className="font-medium">Error loading dashboard</h3>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { summary, hasCriticalAlert, criticalAlertMessage, aeStatuses, exceptionDeals } = data;

  // Prepare data for AI insights
  const insightsData = {
    totalActiveDeals: summary.totalActiveDeals,
    totalExceptions: summary.totalExceptions,
    counts: summary.counts,
    hasCriticalAlert,
    criticalAlertMessage,
    aeStatuses,
    exceptionDeals: exceptionDeals.slice(0, 10), // Limit for context
  };

  return (
    <div className="p-8 bg-gray-50 min-h-full">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Today's Fires</h2>
          <p className="text-sm text-gray-500">{formatDateHeader()}</p>
        </div>
        <AIInsightsButton dashboardType="daily" dashboardData={insightsData} />
      </div>

      {/* Critical Alert Banner */}
      {hasCriticalAlert && criticalAlertMessage && (
        <div className="mb-6 bg-red-600 text-white rounded-xl p-4 flex items-center gap-3 shadow-lg">
          <span className="flex-shrink-0 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-lg">
            !
          </span>
          <div>
            <div className="font-semibold">{criticalAlertMessage}</div>
            <div className="text-sm text-red-100">High-value deals require immediate action</div>
          </div>
        </div>
      )}

      {/* Exception Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ExceptionCountCard
          count={summary.counts.overdueNextSteps}
          label="Overdue Next Steps"
          color={summary.counts.overdueNextSteps > 0 ? 'red' : 'gray'}
        />
        <ExceptionCountCard
          count={summary.counts.pastCloseDates}
          label="Past Close Dates"
          color={summary.counts.pastCloseDates > 0 ? 'red' : 'gray'}
        />
        <ExceptionCountCard
          count={summary.counts.activityDrought}
          label="Activity Drought (10d+)"
          color={summary.counts.activityDrought > 3 ? 'amber' : 'gray'}
        />
      </div>

      {/* AE Status Bar */}
      <div className="mb-6">
        <AEStatusBar aeStatuses={aeStatuses} />
      </div>

      {/* Exception Deals List */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Deals Requiring Action</h3>
          <span className="text-sm text-gray-500">
            {exceptionDeals.length} exception{exceptionDeals.length !== 1 ? 's' : ''} &bull;
            {summary.totalActiveDeals} active deals
          </span>
        </div>

        {exceptionDeals.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">&#10003;</div>
            <h4 className="text-lg font-medium text-gray-900">All Clear</h4>
            <p className="text-sm text-gray-500 mt-1">
              No exceptions found. Your pipeline is healthy.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {exceptionDeals.map((deal) => (
              <ExceptionCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
