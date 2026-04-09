'use client';

import { useState, useMemo, useCallback } from 'react';
import type { DealForecastItem } from '@/lib/command-center/types';
import { mapInternalToAETier, AE_LIKELIHOOD_OPTIONS } from '@/lib/deal-review/config';
import { DealReviewCard } from './deal-review-card';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

type SortKey = 'amount' | 'closeDate' | 'stage' | 'grade' | 'likelihood';
type SortDir = 'asc' | 'desc';

interface DealReviewWorksheetProps {
  initialDeals: DealForecastItem[];
  aeName: string;
  logoutUrl: string;
}

export function DealReviewWorksheet({ initialDeals, aeName, logoutUrl }: DealReviewWorksheetProps) {
  const [deals, setDeals] = useState(initialDeals);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [likelihoodFilter, setLikelihoodFilter] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Unique stages for filter
  const stages = useMemo(
    () => [...new Set(deals.map((d) => d.stage))].sort(),
    [deals],
  );

  // Pipeline summary
  const summary = useMemo(() => {
    const total = deals.reduce((s, d) => s + d.amount, 0);
    const reviewed = deals.filter((d) => d.override).length;
    return { count: deals.length, total, reviewed };
  }, [deals]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = [...deals];

    if (stageFilter !== 'all') {
      result = result.filter((d) => d.stage === stageFilter);
    }
    if (likelihoodFilter !== 'all') {
      result = result.filter((d) => {
        const effective = d.override ? d.override.likelihood : d.likelihoodTier;
        return mapInternalToAETier(effective) === likelihoodFilter;
      });
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'amount':
          cmp = a.amount - b.amount;
          break;
        case 'closeDate':
          cmp = (a.closeDate || '9999').localeCompare(b.closeDate || '9999');
          break;
        case 'stage':
          cmp = a.stage.localeCompare(b.stage);
          break;
        case 'grade':
          cmp = a.overallGrade.localeCompare(b.overallGrade);
          break;
        case 'likelihood': {
          const tierOrder = ['highly_likely', 'likely', 'possible', 'unlikely', 'not_this_quarter', 'insufficient_data'];
          const aEff = a.override ? a.override.likelihood : a.likelihoodTier;
          const bEff = b.override ? b.override.likelihood : b.likelihoodTier;
          cmp = tierOrder.indexOf(aEff) - tierOrder.indexOf(bEff);
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [deals, stageFilter, likelihoodFilter, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(key === 'amount' ? 'desc' : 'asc');
      return key;
    });
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/deal-review');
      if (res.ok) {
        const data = await res.json();
        setDeals(data.deals);
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Q2 Deal Review</h1>
            <p className="text-sm text-gray-500">{aeName}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              <div className="text-gray-500">
                {summary.reviewed}/{summary.count} reviewed
              </div>
              <div className="font-mono font-medium text-gray-900">{fmt(summary.total)} pipeline</div>
            </div>
            <a
              href={logoutUrl}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              Log out
            </a>
          </div>
        </div>
      </header>

      {/* Filters + Sort */}
      <div className="max-w-5xl mx-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Stage filter */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All Stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Likelihood filter */}
          <select
            value={likelihoodFilter}
            onChange={(e) => setLikelihoodFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All Likelihood</option>
            {AE_LIKELIHOOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Sort buttons */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-gray-400 mr-1">Sort:</span>
            {([
              ['amount', 'Amount'],
              ['closeDate', 'Close Date'],
              ['grade', 'Grade'],
              ['likelihood', 'Likelihood'],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`text-xs px-2 py-1 rounded ${
                  sortKey === key
                    ? 'bg-indigo-100 text-indigo-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {label}
                {sortKey === key && (sortDir === 'desc' ? ' \u2193' : ' \u2191')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Deal cards */}
      <div className="max-w-5xl mx-auto px-4 pb-8 space-y-4">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            No deals match your filters.
          </div>
        )}
        {filtered.map((deal) => (
          <DealReviewCard key={deal.hubspotDealId} deal={deal} onOverrideChange={refresh} />
        ))}
      </div>

      {/* Floating refresh */}
      {refreshing && (
        <div className="fixed bottom-6 right-6 bg-white shadow-lg rounded-full px-4 py-2 text-sm text-gray-600 border border-gray-200">
          Refreshing...
        </div>
      )}
    </div>
  );
}
