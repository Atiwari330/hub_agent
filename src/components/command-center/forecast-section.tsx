'use client';

import { useState } from 'react';
import type { ForecastSummary, LikelihoodTier, DealForecastItem } from '@/lib/command-center/types';
import { LIKELIHOOD_WEIGHTS } from '@/lib/command-center/config';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const TIER_CONFIG: { key: LikelihoodTier; label: string; color: string; barColor: string }[] = [
  { key: 'highly_likely', label: 'Highly Likely', color: 'text-emerald-700', barColor: 'bg-emerald-500' },
  { key: 'likely', label: 'Likely', color: 'text-blue-700', barColor: 'bg-blue-500' },
  { key: 'possible', label: 'Possible', color: 'text-amber-700', barColor: 'bg-amber-500' },
  { key: 'unlikely', label: 'Unlikely', color: 'text-red-700', barColor: 'bg-red-400' },
  { key: 'insufficient_data', label: 'Uncertain', color: 'text-gray-500', barColor: 'bg-gray-300' },
];

const CONFIDENCE_CONFIG = {
  high: { label: 'High Confidence', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', detail: '60%+ of weighted forecast from highly likely or likely deals' },
  medium: { label: 'Medium Confidence', color: 'text-amber-700 bg-amber-50 border-amber-200', detail: 'Mixed confidence — significant portion in possible or below' },
  low: { label: 'Low Confidence', color: 'text-red-700 bg-red-50 border-red-200', detail: 'Most of forecast from uncertain deals' },
};

interface ForecastSectionProps {
  forecast: ForecastSummary;
  deals?: DealForecastItem[];
  onDealClick?: (dealId: string) => void;
}

export function ForecastSection({ forecast, deals, onDealClick }: ForecastSectionProps) {
  const [expandedTier, setExpandedTier] = useState<LikelihoodTier | null>(null);
  const maxBarValue = Math.max(forecast.projectedTotal, forecast.target) * 1.1;

  // Stacked bar segments
  const segments = [
    { label: 'Closed Won', value: forecast.closedWonARR, color: 'bg-emerald-600' },
    ...TIER_CONFIG.map((t) => ({
      label: t.label,
      value: forecast.tiers[t.key].weightedARR,
      color: t.barColor,
    })),
  ];

  const conf = CONFIDENCE_CONFIG[forecast.confidenceLevel];

  // Group deals by their effective tier for the expandable rows
  const dealsByTier = deals
    ? TIER_CONFIG.reduce<Record<string, DealForecastItem[]>>((acc, t) => {
        acc[t.key] = deals.filter((d) => {
          const effectiveTier = d.override?.likelihood || d.likelihoodTier;
          return effectiveTier === t.key;
        });
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Rolling Forecast</h2>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${conf.color}`}>
          {conf.label}
        </span>
      </div>

      {/* Stacked forecast bar */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-sm text-gray-700">
            Projected: <span className="font-semibold text-gray-900">{fmt(forecast.projectedTotal)}</span>
          </span>
          <span className="text-sm text-gray-500">
            Target: {fmt(forecast.target)}
            {forecast.gap > 0 && <span className="text-red-600 ml-2">Gap: {fmt(forecast.gap)}</span>}
          </span>
        </div>

        {/* Bar */}
        <div className="relative h-8 rounded-full bg-gray-100 overflow-hidden">
          <div className="absolute inset-y-0 left-0 flex">
            {segments.map((seg, i) => {
              const widthPct = maxBarValue > 0 ? (seg.value / maxBarValue) * 100 : 0;
              if (widthPct < 0.5) return null;
              return (
                <div
                  key={i}
                  className={`h-full ${seg.color} ${i === 0 ? 'rounded-l-full' : ''}`}
                  style={{ width: `${widthPct}%` }}
                  title={`${seg.label}: ${fmt(seg.value)}`}
                />
              );
            })}
          </div>
          {/* Target line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-900"
            style={{ left: `${Math.min(100, (forecast.target / maxBarValue) * 100)}%` }}
          >
            <div className="absolute -top-5 -translate-x-1/2 text-[10px] font-medium text-gray-700 whitespace-nowrap">
              Target
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-3 h-3 rounded-sm bg-emerald-600" />
            <span className="text-gray-600">Closed Won</span>
          </div>
          {TIER_CONFIG.map((t) => (
            <div key={t.key} className="flex items-center gap-1.5 text-xs">
              <div className={`w-3 h-3 rounded-sm ${t.barColor}`} />
              <span className="text-gray-600">{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tier breakdown table */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-medium text-gray-700">Tier Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="pb-3 pr-4">Tier</th>
              <th className="pb-3 pr-4 text-right">Deals</th>
              <th className="pb-3 pr-4 text-right">Raw ARR</th>
              <th className="pb-3 pr-4 text-right">Weight</th>
              <th className="pb-3 text-right">Weighted ARR</th>
            </tr>
          </thead>
          <tbody>
            {TIER_CONFIG.map((t) => {
              const tier = forecast.tiers[t.key];
              const isExpanded = expandedTier === t.key;
              const tierDeals = dealsByTier[t.key] || [];
              const hasDeals = tierDeals.length > 0;

              return (
                <>
                  <tr
                    key={t.key}
                    className={`border-b border-gray-100 ${hasDeals ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={() => hasDeals && setExpandedTier(isExpanded ? null : t.key)}
                  >
                    <td className={`py-2.5 pr-4 font-medium ${t.color}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {hasDeals && (
                          <svg
                            className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                        {t.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-gray-900">{tier.count}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-gray-500">{fmt(tier.rawARR)}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-gray-400">{Math.round(LIKELIHOOD_WEIGHTS[t.key] * 100)}%</td>
                    <td className="py-2.5 text-right font-mono text-gray-900">{fmt(Math.round(tier.weightedARR))}</td>
                  </tr>
                  {isExpanded && tierDeals.length > 0 && (
                    <tr key={`${t.key}-deals`}>
                      <td colSpan={5} className="p-0">
                        <div className="bg-gray-50 px-4 py-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400 uppercase tracking-wider">
                                <th className="pb-1.5 pr-3">Deal</th>
                                <th className="pb-1.5 pr-3">Owner</th>
                                <th className="pb-1.5 pr-3 text-right">Amount</th>
                                <th className="pb-1.5 pr-3">Stage</th>
                                <th className="pb-1.5">LLM Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tierDeals.map((deal) => (
                                <tr
                                  key={deal.hubspotDealId}
                                  className="border-t border-gray-200 hover:bg-gray-100 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDealClick?.(deal.hubspotDealId);
                                  }}
                                >
                                  <td className="py-1.5 pr-3 text-blue-600 hover:underline">{deal.dealName}</td>
                                  <td className="py-1.5 pr-3 text-gray-600">{deal.ownerName}</td>
                                  <td className="py-1.5 pr-3 text-right font-mono text-gray-700">{fmt(deal.amount)}</td>
                                  <td className="py-1.5 pr-3 text-gray-600">{deal.stage}</td>
                                  <td className="py-1.5 text-gray-500">{deal.llmStatus || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium text-gray-900">
              <td className="pt-3 pr-4">Total Weighted</td>
              <td className="pt-3 pr-4 text-right font-mono">
                {Object.values(forecast.tiers).reduce((s, t) => s + t.count, 0)}
              </td>
              <td className="pt-3 pr-4 text-right font-mono">
                {fmt(Object.values(forecast.tiers).reduce((s, t) => s + t.rawARR, 0))}
              </td>
              <td />
              <td className="pt-3 text-right font-mono">{fmt(forecast.totalWeighted)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Confidence detail */}
        <div className={`mt-4 rounded border px-3 py-2 text-xs ${conf.color}`}>
          {conf.detail}
        </div>
      </div>
    </div>
  );
}
