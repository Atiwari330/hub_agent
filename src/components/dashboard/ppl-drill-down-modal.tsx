'use client';

import { useEffect, useState } from 'react';

interface PplDeal {
  dealId: string;
  dealName: string;
  ownerName: string;
  createdAt: string;
  daysElapsed: number;
  uniqueTouchDays: number;
  totalTouches: number;
  calls: number;
  emails: number;
  compliance: number;
  firstWeekComplete: boolean;
  hubspotUrl: string;
}

interface PplDrillDownResponse {
  deals: PplDeal[];
  weekLabel: string;
}

interface PplDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  quarter: number;
  weekNumber: number;
  ownerId?: string;
  ownerName?: string;
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

function complianceColor(compliance: number): { text: string; bg: string } {
  if (compliance >= 0.8) return { text: 'text-green-700', bg: 'bg-green-100' };
  if (compliance >= 0.5) return { text: 'text-yellow-700', bg: 'bg-yellow-100' };
  return { text: 'text-red-700', bg: 'bg-red-100' };
}

function DealCard({ deal, showOwner }: { deal: PplDeal; showOwner: boolean }) {
  const colors = complianceColor(deal.compliance);
  const pct = Math.round(deal.compliance * 100);

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      {/* Deal header */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <a
          href={deal.hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1"
        >
          {deal.dealName}
          <ExternalLinkIcon className="text-indigo-400" />
        </a>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.text} ${colors.bg}`}>
          {pct}%
        </span>
      </div>

      {/* Owner (only for team total view) */}
      {showOwner && (
        <div className="text-xs text-gray-500 mb-2">
          Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span>
        </div>
      )}

      {/* Compliance details */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>
          <span className="font-medium text-gray-900">{deal.uniqueTouchDays}</span>/{deal.daysElapsed} days touched
        </span>
        <span className="text-gray-300">|</span>
        <span>
          <span className="font-medium text-gray-900">{deal.totalTouches}</span> touches
          <span className="text-gray-400 text-xs ml-1">
            ({deal.calls} call{deal.calls !== 1 ? 's' : ''}, {deal.emails} email{deal.emails !== 1 ? 's' : ''})
          </span>
        </span>
      </div>

      {/* Footer: created date + status */}
      <div className="flex items-center justify-between mt-3 text-xs">
        <span className="text-gray-400">
          Created {new Date(deal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <span className={`px-2 py-0.5 rounded font-medium ${
          deal.firstWeekComplete
            ? 'bg-gray-100 text-gray-600'
            : 'bg-blue-50 text-blue-600'
        }`}>
          {deal.firstWeekComplete ? 'Week Complete' : 'In Progress'}
        </span>
      </div>
    </div>
  );
}

export function PplDrillDownModal({
  isOpen,
  onClose,
  year,
  quarter,
  weekNumber,
  ownerId,
  ownerName,
}: PplDrillDownModalProps) {
  const [data, setData] = useState<PplDrillDownResponse | null>(null);
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
        const params = new URLSearchParams({
          year: String(year),
          quarter: String(quarter),
          weekNumber: String(weekNumber),
        });
        if (ownerId) params.set('ownerId', ownerId);

        const response = await fetch(`/api/hot-tracker/ppl-deals?${params}`);
        if (!response.ok) throw new Error('Failed to fetch PPL deal details');

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isOpen, year, quarter, weekNumber, ownerId]);

  if (!isOpen) return null;

  const showOwner = !ownerId; // show owner column for team total view

  const title = ownerName
    ? `PPL Daily Touch Compliance — ${ownerName}`
    : 'PPL Daily Touch Compliance — Team Total';

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
                {data.weekLabel} — {data.deals.length} deal{data.deals.length !== 1 ? 's' : ''}
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

          {!loading && !error && data && data.deals.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No PPL deals found for this week.</p>
            </div>
          )}

          {!loading && !error && data && data.deals.length > 0 && (
            <div className="space-y-4">
              {data.deals.map((deal) => (
                <DealCard key={deal.dealId} deal={deal} showOwner={showOwner} />
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
