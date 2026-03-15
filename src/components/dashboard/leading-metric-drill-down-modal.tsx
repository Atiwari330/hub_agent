'use client';

import { useEffect, useState } from 'react';

type MetricType = 'speedToDemo' | 'untouchedDeals' | 'demoConversion';

interface LeadingMetricDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  year: number;
  quarter: number;
  weekNumber: number;
  metricType: MetricType;
  ownerId?: string;
  ownerName?: string;
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const METRIC_CONFIG: Record<MetricType, { endpoint: string; title: string }> = {
  speedToDemo: { endpoint: '/api/hot-tracker/speed-to-demo-deals', title: 'Speed to Demo' },
  untouchedDeals: { endpoint: '/api/hot-tracker/untouched-deals', title: 'Untouched Deals' },
  demoConversion: { endpoint: '/api/hot-tracker/demo-conversion-deals', title: 'Demo → Proposal Conversion' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SpeedToDemoCard({ deal, showOwner }: { deal: any; showOwner: boolean }) {
  const daysColor = deal.daysBetween <= 5 ? 'bg-green-100 text-green-700'
    : deal.daysBetween <= 10 ? 'bg-yellow-100 text-yellow-700'
    : 'bg-red-100 text-red-700';

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1">
          {deal.dealName}
          <ExternalLinkIcon className="text-indigo-400" />
        </a>
        {deal.daysBetween !== null && (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${daysColor}`}>
            {deal.daysBetween.toFixed(1)}d
          </span>
        )}
      </div>
      {showOwner && <div className="text-xs text-gray-500 mb-2">Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>{deal.usedFallback ? 'Created' : 'MQL'}: <span className="font-medium text-gray-900">{formatDate(deal.mqlDate || deal.createdDate)}</span></span>
        <span className="text-gray-300">→</span>
        <span>Demo Scheduled: <span className="font-medium text-gray-900">{formatDate(deal.demoScheduledDate)}</span></span>
        {deal.amount !== null && (
          <>
            <span className="text-gray-300">|</span>
            <span className="font-medium text-gray-900">{formatCurrency(deal.amount)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function UntouchedDealCard({ deal, showOwner }: { deal: any; showOwner: boolean }) {
  return (
    <div className="border border-red-200 rounded-lg p-4 bg-red-50/30 hover:border-red-300 transition-colors">
      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1">
          {deal.dealName}
          <ExternalLinkIcon className="text-indigo-400" />
        </a>
        {deal.amount !== null && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{formatCurrency(deal.amount)}</span>
        )}
      </div>
      {showOwner && <div className="text-xs text-gray-500 mb-2">Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>Stage: <span className="font-medium text-gray-900">{deal.stageName}</span></span>
        {deal.closeDate && (
          <>
            <span className="text-gray-300">|</span>
            <span>Close: <span className="font-medium text-gray-900">{formatDate(deal.closeDate)}</span></span>
          </>
        )}
        {deal.lastActivityDate && (
          <>
            <span className="text-gray-300">|</span>
            <span>Last Activity: <span className="font-medium text-gray-900">{formatDate(deal.lastActivityDate)}</span></span>
          </>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DemoConversionCard({ deal, showOwner }: { deal: any; showOwner: boolean }) {
  const statusColors = {
    converted: 'bg-green-100 text-green-700',
    pending: 'bg-blue-100 text-blue-700',
    missed: 'bg-red-100 text-red-700',
  };
  const statusLabels = { converted: 'Converted', pending: 'Pending', missed: 'Not Converted' };

  return (
    <div className={`border rounded-lg p-4 hover:border-gray-300 transition-colors ${
      deal.status === 'converted' ? 'border-green-200' : deal.status === 'missed' ? 'border-red-200 bg-red-50/30' : 'border-blue-200 bg-blue-50/30'
    }`}>
      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={deal.hubspotUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1">
          {deal.dealName}
          <ExternalLinkIcon className="text-indigo-400" />
        </a>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[deal.status as keyof typeof statusColors]}`}>
          {deal.daysBetween !== null ? `${deal.daysBetween}d` : statusLabels[deal.status as keyof typeof statusLabels]}
        </span>
      </div>
      {showOwner && <div className="text-xs text-gray-500 mb-2">Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>Demo Completed: <span className="font-medium text-gray-900">{formatDate(deal.demoCompletedDate)}</span></span>
        <span className="text-gray-300">→</span>
        <span>Proposal: <span className="font-medium text-gray-900">{deal.proposalDate ? formatDate(deal.proposalDate) : deal.status === 'pending' ? 'Pending...' : 'N/A'}</span></span>
        {deal.amount !== null && (
          <>
            <span className="text-gray-300">|</span>
            <span className="font-medium text-gray-900">{formatCurrency(deal.amount)}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function LeadingMetricDrillDownModal({
  isOpen, onClose, year, quarter, weekNumber, metricType, ownerId, ownerName,
}: LeadingMetricDrillDownModalProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) { setData(null); setError(null); return; }

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const config = METRIC_CONFIG[metricType];
        const params = new URLSearchParams({ year: String(year), quarter: String(quarter), weekNumber: String(weekNumber) });
        if (ownerId) params.set('ownerId', ownerId);

        const response = await fetch(`${config.endpoint}?${params}`);
        if (!response.ok) throw new Error('Failed to fetch details');
        setData(await response.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isOpen, year, quarter, weekNumber, metricType, ownerId]);

  if (!isOpen) return null;

  const showOwner = !ownerId;
  const config = METRIC_CONFIG[metricType];
  const title = ownerName ? `${config.title} — ${ownerName}` : `${config.title} — Team Total`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {data && (
              <p className="text-sm text-gray-500 mt-1">
                {data.weekLabel} — {data.deals.length} deal{data.deals.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Close">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}
          {error && <div className="text-center py-12"><p className="text-red-500">{error}</p></div>}
          {!loading && !error && data && data.deals.length === 0 && <div className="text-center py-12"><p className="text-gray-500">No deals found for this week.</p></div>}
          {!loading && !error && data && data.deals.length > 0 && (
            <div className="space-y-4">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {data.deals.map((deal: any) => {
                if (metricType === 'speedToDemo') return <SpeedToDemoCard key={deal.dealId} deal={deal} showOwner={showOwner} />;
                if (metricType === 'untouchedDeals') return <UntouchedDealCard key={deal.dealId || deal.dealName} deal={deal} showOwner={showOwner} />;
                return <DemoConversionCard key={deal.dealId} deal={deal} showOwner={showOwner} />;
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}
