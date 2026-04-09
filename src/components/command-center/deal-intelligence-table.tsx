'use client';

import { useState, useMemo } from 'react';
import type { DealForecastItem } from '@/lib/command-center/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
};

const LIKELIHOOD_COLORS: Record<string, string> = {
  highly_likely: 'bg-emerald-100 text-emerald-800',
  likely: 'bg-blue-100 text-blue-800',
  possible: 'bg-amber-100 text-amber-800',
  unlikely: 'bg-red-100 text-red-800',
  insufficient_data: 'bg-gray-100 text-gray-600',
};

const LIKELIHOOD_LABELS: Record<string, string> = {
  highly_likely: 'Highly Likely',
  likely: 'Likely',
  possible: 'Possible',
  unlikely: 'Unlikely',
  insufficient_data: 'No Data',
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'text-emerald-700',
  neutral: 'text-gray-600',
  negative: 'text-red-700',
};

type SortKey = 'dealName' | 'ownerName' | 'amount' | 'overallScore' | 'likelihoodTier' | 'stage';

interface DealIntelligenceTableProps {
  deals: DealForecastItem[];
  onSelectDeal: (dealId: string) => void;
  aeFilter: string | null;
  onClearAeFilter: () => void;
}

export function DealIntelligenceTable({ deals, onSelectDeal, aeFilter, onClearAeFilter }: DealIntelligenceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('overallScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<Set<string>>(new Set());
  const [likelihoodFilter, setLikelihoodFilter] = useState<Set<string>>(new Set());

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleGrade = (g: string) => {
    const next = new Set(gradeFilter);
    next.has(g) ? next.delete(g) : next.add(g);
    setGradeFilter(next);
  };

  const toggleLikelihood = (l: string) => {
    const next = new Set(likelihoodFilter);
    next.has(l) ? next.delete(l) : next.add(l);
    setLikelihoodFilter(next);
  };

  const filtered = useMemo(() => {
    let list = [...deals];
    if (aeFilter) list = list.filter((d) => d.ownerId === aeFilter);
    if (gradeFilter.size > 0) list = list.filter((d) => gradeFilter.has(d.overallGrade));
    if (likelihoodFilter.size > 0) list = list.filter((d) => likelihoodFilter.has(d.likelihoodTier));

    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'amount') cmp = a.amount - b.amount;
      else if (sortKey === 'overallScore') cmp = a.overallScore - b.overallScore;
      else {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        cmp = String(av).localeCompare(String(bv));
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [deals, aeFilter, gradeFilter, likelihoodFilter, sortKey, sortAsc]);

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500 cursor-pointer hover:text-gray-900 select-none"
      onClick={() => toggleSort(field)}
    >
      {label}
      {sortKey === field && (
        <span className="ml-1">{sortAsc ? '\u25B2' : '\u25BC'}</span>
      )}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Deal Intelligence</h2>
        <span className="text-sm text-gray-500">{filtered.length} deals</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Grade filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Grade:</span>
          {['A', 'B', 'C', 'D', 'F'].map((g) => (
            <button
              key={g}
              onClick={() => toggleGrade(g)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                gradeFilter.has(g) ? GRADE_COLORS[g] : 'bg-gray-100 text-gray-400'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Likelihood filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Likelihood:</span>
          {Object.entries(LIKELIHOOD_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleLikelihood(key)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                likelihoodFilter.has(key) ? LIKELIHOOD_COLORS[key] : 'bg-gray-100 text-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* AE filter indicator */}
        {aeFilter && (
          <button
            onClick={onClearAeFilter}
            className="flex items-center gap-1 rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
          >
            Filtered by AE
            <span className="ml-1">&times;</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b border-gray-200">
            <tr>
              <SortHeader label="Deal" field="dealName" />
              <SortHeader label="Owner" field="ownerName" />
              <SortHeader label="Stage" field="stage" />
              <SortHeader label="Amount" field="amount" />
              <th className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500">Grade</th>
              <th className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500">Likelihood</th>
              <th className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500">Sentiment</th>
              <th className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500">Risk</th>
              <th className="px-3 py-3 text-left text-xs uppercase tracking-wider text-gray-500 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((deal, i) => (
              <tr
                key={deal.hubspotDealId}
                onClick={() => onSelectDeal(deal.hubspotDealId)}
                className={`border-b border-gray-100 cursor-pointer hover:bg-indigo-50 transition-colors ${
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">
                  {deal.dealName}
                </td>
                <td className="px-3 py-2.5 text-gray-600">{deal.ownerName}</td>
                <td className="px-3 py-2.5 text-gray-600 text-xs">{deal.stage}</td>
                <td className="px-3 py-2.5 font-mono text-gray-900">{fmt(deal.amount)}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${GRADE_COLORS[deal.overallGrade] || 'bg-gray-100 text-gray-600'}`}>
                    {deal.overallGrade}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${LIKELIHOOD_COLORS[deal.likelihoodTier] || 'bg-gray-100 text-gray-600'}`}>
                    {LIKELIHOOD_LABELS[deal.likelihoodTier] || deal.likelihoodTier}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {deal.buyerSentiment ? (
                    <span className={`text-xs font-medium capitalize ${SENTIMENT_COLORS[deal.buyerSentiment] || 'text-gray-500'}`}>
                      {deal.buyerSentiment}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">–</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[150px] truncate" title={deal.keyRisk || ''}>
                  {deal.keyRisk || '–'}
                </td>
                <td className="px-3 py-2.5 text-gray-400">
                  {deal.override && (
                    <span title="Has override" className="text-indigo-500 text-xs font-bold">O</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-400">
                  No deals match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
