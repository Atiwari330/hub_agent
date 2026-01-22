'use client';

import { useEffect, useState } from 'react';
import type { CallDrillDownResponse, CallWithAssociations } from '@/types/calls';

interface CallDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerId: string;
  period: string; // e.g., 'today', 'this_week', etc.
  periodLabel: string;
  filterType: 'date' | 'outcome';
  filterValue: string;
}

const OUTCOME_COLORS: Record<string, { text: string; bg: string }> = {
  Connected: { text: 'text-emerald-700', bg: 'bg-emerald-100' },
  'Left Voicemail': { text: 'text-amber-700', bg: 'bg-amber-100' },
  'Left Live Message': { text: 'text-amber-700', bg: 'bg-amber-100' },
  'No Answer': { text: 'text-gray-700', bg: 'bg-gray-100' },
  'Wrong Number': { text: 'text-red-700', bg: 'bg-red-100' },
  Busy: { text: 'text-gray-700', bg: 'bg-gray-100' },
  Unknown: { text: 'text-gray-600', bg: 'bg-gray-50' },
};

function formatCurrency(amount: number | null): string {
  if (amount === null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      width="14"
      height="14"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function CallCard({ call }: { call: CallWithAssociations }) {
  const outcomeStyle = OUTCOME_COLORS[call.outcomeLabel] || OUTCOME_COLORS.Unknown;

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      {/* Call header */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-900">{formatTime(call.timestamp)}</span>
          <span className="text-gray-400">·</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeStyle.text} ${outcomeStyle.bg}`}>
            {call.outcomeLabel}
          </span>
          {call.durationMs && call.durationMs > 0 && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{call.durationFormatted}</span>
            </>
          )}
        </div>
      </div>

      {/* Title (if present) */}
      {call.title && (
        <p className="text-sm text-gray-700 mb-3">{call.title}</p>
      )}

      {/* Contacts */}
      {call.contacts.length > 0 && (
        <div className="mb-2">
          {call.contacts.map((contact) => (
            <div key={contact.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Contact:</span>
              <a
                href={contact.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1"
              >
                {contact.name || contact.email || 'Unknown Contact'}
                <ExternalLinkIcon className="text-indigo-400" />
              </a>
              {contact.email && contact.name && (
                <span className="text-gray-400">({contact.email})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Deals */}
      {call.deals.length > 0 && (
        <div className="mb-3">
          {call.deals.map((deal) => (
            <div key={deal.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Deal:</span>
              <a
                href={deal.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1"
              >
                {deal.name}
                <ExternalLinkIcon className="text-indigo-400" />
              </a>
              {deal.amount !== null && (
                <span className="text-gray-600 font-medium">{formatCurrency(deal.amount)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* View in HubSpot */}
      <a
        href={call.hubspotUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 transition-colors"
      >
        View Call in HubSpot
        <ExternalLinkIcon />
      </a>
    </div>
  );
}

export function CallDrillDownModal({
  isOpen,
  onClose,
  ownerId,
  period,
  periodLabel,
  filterType,
  filterValue,
}: CallDrillDownModalProps) {
  const [data, setData] = useState<CallDrillDownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setData(null);
      setError(null);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          period,
          includeAssociations: 'true',
        });

        if (filterType === 'date') {
          params.set('date', filterValue);
        } else {
          params.set('outcome', filterValue);
        }

        const response = await fetch(`/api/ae/${ownerId}/calls?${params}`);

        if (!response.ok) {
          throw new Error('Failed to fetch call details');
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
  }, [isOpen, ownerId, period, filterType, filterValue]);

  if (!isOpen) return null;

  // Build title based on filter type
  let title: string;
  if (filterType === 'date' && data?.filter) {
    title = `Calls on ${data.filter.label}`;
  } else if (filterType === 'outcome' && data?.filter) {
    title = `${data.filter.label} Calls - ${periodLabel}`;
  } else if (filterType === 'date') {
    // Loading state
    const dateObj = new Date(filterValue + 'T12:00:00');
    title = `Calls on ${dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
  } else {
    title = `Calls - ${periodLabel}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {data && (
              <p className="text-sm text-gray-500 mt-1">
                {data.calls.length} call{data.calls.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-500">{error}</p>
              <button
                onClick={onClose}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>
          )}

          {!loading && !error && data && data.calls.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No calls found for this filter.</p>
            </div>
          )}

          {!loading && !error && data && data.calls.length > 0 && (
            <div className="space-y-4">
              {data.calls.map((call) => (
                <CallCard key={call.id} call={call} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
