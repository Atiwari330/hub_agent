'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { ExceptionContextResponse } from '@/types/exception-context';

export type ExceptionType =
  | 'overdue_next_step'
  | 'past_close_date'
  | 'activity_drought'
  | 'no_next_step'
  | 'stale_stage'
  | 'high_value_at_risk';

export interface ExceptionDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  exceptionType: ExceptionType;
  exceptionDetail: string;
  daysSinceActivity: number | null;
  daysInStage: number | null;
  nextStepDueDate: string | null;
}

interface ExceptionCardProps {
  deal: ExceptionDeal;
}

const EXCEPTION_LABELS: Record<ExceptionType, { label: string; color: string; icon: string }> = {
  overdue_next_step: {
    label: 'Overdue Next Step',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '!',
  },
  past_close_date: {
    label: 'Past Close Date',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '!',
  },
  activity_drought: {
    label: 'No Activity',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '?',
  },
  no_next_step: {
    label: 'No Next Step',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '-',
  },
  stale_stage: {
    label: 'Stuck in Stage',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '~',
  },
  high_value_at_risk: {
    label: 'High Value At Risk',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '$',
  },
};

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function ExceptionCard({ deal }: ExceptionCardProps) {
  const [context, setContext] = useState<ExceptionContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exception = EXCEPTION_LABELS[deal.exceptionType];
  const hubspotUrl = getHubSpotDealUrl(deal.hubspotDealId);

  async function loadContext() {
    if (context || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Strip -hvr suffix for high_value_at_risk deals (they use modified IDs for React keys)
      const actualDealId = deal.id.replace(/-hvr$/, '');
      const res = await fetch(
        `/api/deals/${actualDealId}/exception-context?type=${deal.exceptionType}`
      );
      if (res.ok) {
        setContext(await res.json());
      } else {
        setError('Failed to generate analysis');
      }
    } catch (err) {
      console.error('Failed to load context:', err);
      setError('Failed to generate analysis');
    } finally {
      setLoading(false);
    }
  }

  function handleToggle() {
    if (!expanded) {
      loadContext();
    }
    setExpanded(!expanded);
  }

  const urgencyColors = {
    critical: 'bg-red-50 text-red-900 border-red-200',
    high: 'bg-amber-50 text-amber-900 border-amber-200',
    medium: 'bg-blue-50 text-blue-900 border-blue-200',
    low: 'bg-slate-50 text-slate-900 border-slate-200',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        {/* Deal info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-900 hover:text-indigo-600 truncate"
            >
              {deal.dealName}
            </a>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ${exception.color}`}>
              {exception.label}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              {deal.amount ? formatCurrency(deal.amount) : '-'}
            </span>
            <span>&bull;</span>
            <span>{deal.stageName}</span>
            <span>&bull;</span>
            <span>Close: {formatDate(deal.closeDate)}</span>
          </div>

          <p className="mt-1 text-xs text-gray-600">{deal.exceptionDetail}</p>

          {/* AI Analysis Toggle */}
          <button
            onClick={handleToggle}
            className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? 'Hide AI Analysis' : 'Show AI Analysis'}
          </button>

          {/* Expandable AI Context */}
          {expanded && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              {loading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                  <div className="h-3 bg-slate-200 rounded w-full"></div>
                  <div className="h-3 bg-slate-200 rounded w-5/6"></div>
                </div>
              ) : error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : context ? (
                <>
                  <p className="text-sm font-medium text-slate-900">{context.diagnosis}</p>
                  <p className="text-xs text-slate-600 mt-2">{context.recentActivity}</p>
                  <div className={`mt-3 p-2 rounded border text-sm ${urgencyColors[context.urgency]}`}>
                    <strong>Action:</strong> {context.recommendedAction}
                  </div>
                  {context.cached && (
                    <p className="text-xs text-slate-400 mt-2">
                      Generated {new Date(context.generatedAt).toLocaleString()}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">Unable to generate analysis</p>
              )}
            </div>
          )}
        </div>

        {/* Owner */}
        <div className="flex-shrink-0 text-right">
          <a
            href={`/dashboard/ae/${deal.ownerId}`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {deal.ownerName}
          </a>
        </div>
      </div>
    </div>
  );
}

interface ExceptionListProps {
  deals: ExceptionDeal[];
  title: string;
  emptyMessage?: string;
}

export function ExceptionList({ deals, title, emptyMessage = 'No exceptions' }: ExceptionListProps) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
      {deals.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => (
            <ExceptionCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}
