'use client';

import { useEffect, useState } from 'react';

interface CallRecord {
  id: string;
  timestampEST: string;
  ownerName: string;
  outcome: string;
  isConnected: boolean;
  durationFormatted: string;
}

interface DrillDownResponse {
  calls: CallRecord[];
  day: string;
  hourLabel: string;
  totalCalls: number;
  connectedCalls: number;
  connectRate: number;
}

interface HeatmapDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: string;
  hour: number;
  hourLabel: string;
}

const OUTCOME_STYLES: Record<string, string> = {
  Connected: 'bg-emerald-100 text-emerald-700',
  'Left Voicemail': 'bg-amber-100 text-amber-700',
  'Left Live Message': 'bg-amber-100 text-amber-700',
  'No Answer': 'bg-gray-100 text-gray-600',
  Busy: 'bg-gray-100 text-gray-600',
  'Wrong Number': 'bg-red-100 text-red-700',
  Unknown: 'bg-gray-50 text-gray-500',
};

function getOutcomeBadgeClass(outcome: string): string {
  return OUTCOME_STYLES[outcome] || OUTCOME_STYLES.Unknown;
}

export function HeatmapDrillDownModal({
  isOpen,
  onClose,
  day,
  hour,
  hourLabel,
}: HeatmapDrillDownModalProps) {
  const [data, setData] = useState<DrillDownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setData(null);
      setError(null);
      return;
    }

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ day, hour: String(hour) });
        const response = await fetch(`/api/dashboard/call-patterns/drill-down?${params}`);
        if (!response.ok) throw new Error('Failed to fetch call details');

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isOpen, day, hour]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Calls — {day} at {hourLabel}
            </h2>
            {data && (
              <p className="text-sm text-gray-500 mt-1">
                {data.totalCalls} call{data.totalCalls !== 1 ? 's' : ''} — {data.connectedCalls} connected ({data.connectRate.toFixed(1)}%)
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
              <button onClick={onClose} className="mt-4 text-sm text-gray-500 hover:text-gray-700">
                Close
              </button>
            </div>
          )}

          {!loading && !error && data && data.calls.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No calls found for this time slot.</p>
            </div>
          )}

          {!loading && !error && data && data.calls.length > 0 && (
            <div className="space-y-2">
              {data.calls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center gap-4 py-3 px-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                >
                  {/* Outcome badge */}
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getOutcomeBadgeClass(call.outcome)}`}>
                    {call.outcome}
                  </span>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 font-medium">{call.ownerName}</div>
                    <div className="text-xs text-gray-500">{call.timestampEST} EST</div>
                  </div>

                  {/* Duration */}
                  {call.isConnected && call.durationFormatted !== '-' && (
                    <span className="text-sm text-gray-500 font-mono">{call.durationFormatted}</span>
                  )}
                </div>
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
