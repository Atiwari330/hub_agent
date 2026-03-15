'use client';

import { useEffect, useState } from 'react';

interface StageDeal {
  dealId: string;
  dealName: string;
  ownerName: string;
  amount: number | null;
  closeDate: string | null;
  stageName: string;
  enteredAt: string;
  hubspotUrl: string;
}

interface StageDealsDrillDownResponse {
  deals: StageDeal[];
  weekLabel: string;
  stageLabel: string;
}

interface StageDealsDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  quarter: number;
  weekNumber: number;
  stage: string;
  stageLabel: string;
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

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function StageDealCard({ deal, showOwner }: { deal: StageDeal; showOwner: boolean }) {
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
        {deal.amount !== null && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
            {formatCurrency(deal.amount)}
          </span>
        )}
      </div>

      {/* Owner (only for team total view) */}
      {showOwner && (
        <div className="text-xs text-gray-500 mb-2">
          Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span>
        </div>
      )}

      {/* Deal details */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>
          Stage: <span className="font-medium text-gray-900">{deal.stageName}</span>
        </span>
        {deal.closeDate && (
          <>
            <span className="text-gray-300">|</span>
            <span>
              Close: <span className="font-medium text-gray-900">
                {new Date(deal.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Footer: entered date */}
      <div className="mt-3 text-xs text-gray-400">
        Entered {new Date(deal.enteredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        {' at '}
        {new Date(deal.enteredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  );
}

export function StageDealsDrillDownModal({
  isOpen,
  onClose,
  year,
  quarter,
  weekNumber,
  stage,
  stageLabel,
  ownerId,
  ownerName,
}: StageDealsDrillDownModalProps) {
  const [data, setData] = useState<StageDealsDrillDownResponse | null>(null);
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
          stage,
        });
        if (ownerId) params.set('ownerId', ownerId);

        const response = await fetch(`/api/hot-tracker/stage-deals?${params}`);
        if (!response.ok) throw new Error('Failed to fetch stage deal details');

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isOpen, year, quarter, weekNumber, stage, ownerId]);

  if (!isOpen) return null;

  const showOwner = !ownerId;
  const title = ownerName
    ? `${stageLabel} — ${ownerName}`
    : `${stageLabel} — Team Total`;

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
              <p className="text-gray-500">No deals found for this stage and week.</p>
            </div>
          )}

          {!loading && !error && data && data.deals.length > 0 && (
            <div className="space-y-4">
              {data.deals.map((deal) => (
                <StageDealCard key={deal.dealId} deal={deal} showOwner={showOwner} />
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
