'use client';

import { useState, useEffect, useCallback } from 'react';
import { QueueDealCard } from './queue-deal-card';

interface NextStepQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  status: 'missing' | 'overdue';
  nextStep: string | null;
  nextStepDueDate: string | null;
  daysOverdue: number | null;
  reason: string;
}

interface NextStepQueueResponse {
  deals: NextStepQueueDeal[];
  counts: {
    missing: number;
    overdue: number;
    total: number;
  };
}

type StatusFilter = 'all' | 'missing' | 'overdue';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'overdue', label: 'Overdue' },
];

export function NextStepQueueView() {
  const [data, setData] = useState<NextStepQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      const response = await fetch(`/api/queues/next-step?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch next-step queue');
      }
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getTabCount = (tab: StatusFilter): number => {
    if (!data) return 0;
    switch (tab) {
      case 'all':
        return data.counts.total;
      case 'missing':
        return data.counts.missing;
      case 'overdue':
        return data.counts.overdue;
      default:
        return 0;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Next Step Queue</h1>
        <p className="text-sm text-gray-600 mt-1">
          Deals with missing or overdue next steps. Keep deals moving forward.
        </p>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              statusFilter === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
            <span
              className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                statusFilter === tab.value
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {getTabCount(tab.value)}
            </span>
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && data?.deals.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">All caught up!</h3>
          <p className="mt-1 text-sm text-gray-500">
            {statusFilter === 'all'
              ? 'No deals with next step issues right now.'
              : `No deals matching the "${STATUS_TABS.find((t) => t.value === statusFilter)?.label}" filter.`}
          </p>
        </div>
      )}

      {/* Deals Grid */}
      {!loading && !error && data && data.deals.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.deals.map((deal) => (
            <QueueDealCard key={deal.id} deal={deal} type="next-step" />
          ))}
        </div>
      )}
    </div>
  );
}
