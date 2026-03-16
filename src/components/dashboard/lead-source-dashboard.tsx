'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/utils/currency';
import { LeadSourceDealsModal, type DealRecord } from '@/components/dashboard/lead-source-deals-modal';

interface SourceStages {
  mql: number;
  sqlDiscovery: number;
  demoScheduled: number;
  demoCompleted: number;
  proposal: number;
  closedWon: number;
}

interface SourceSummary {
  leadSource: string;
  totalDeals: number;
  totalAmount: number;
  stages: SourceStages;
  closedWonAmount: number;
  conversionRates: {
    mqlToSqlDiscovery: number;
    sqlDiscoveryToDemo: number;
    demoToProposal: number;
    proposalToWon: number;
    overallWinRate: number;
  };
}

interface TrendWeek {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  sources: Record<string, number>;
  total: number;
}

interface LeadSourceData {
  dateRange: { startDate: string; endDate: string };
  totalDeals: number;
  totalClosedWon: number;
  totalAmount: number;
  totalClosedWonAmount: number;
  overallWinRate: number;
  sources: SourceSummary[];
  trend: TrendWeek[];
  deals: DealRecord[];
}

const STAGE_CONFIG = {
  mql: { label: 'MQL', color: 'bg-sky-400', textColor: 'text-sky-600' },
  sqlDiscovery: { label: 'SQL/Discovery', color: 'bg-blue-500', textColor: 'text-blue-600' },
  demoScheduled: { label: 'Demo Sched', color: 'bg-yellow-500', textColor: 'text-yellow-600' },
  demoCompleted: { label: 'Demo Comp', color: 'bg-purple-500', textColor: 'text-purple-600' },
  proposal: { label: 'Proposal', color: 'bg-orange-500', textColor: 'text-orange-600' },
  closedWon: { label: 'Closed Won', color: 'bg-emerald-500', textColor: 'text-emerald-600' },
} as const;

type StageKey = keyof typeof STAGE_CONFIG;
const STAGE_KEYS = Object.keys(STAGE_CONFIG) as StageKey[];

// Assign consistent colors to lead sources
const SOURCE_COLORS = [
  'bg-sky-500',
  'bg-indigo-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-emerald-500',
  'bg-purple-500',
  'bg-teal-500',
  'bg-orange-500',
];

export function LeadSourceDashboard() {
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [data, setData] = useState<LeadSourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{ title: string; deals: DealRecord[] } | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          `/api/dashboard/lead-source-analysis?startDate=${startDate}&endDate=${endDate}`
        );
        if (!response.ok) throw new Error('Failed to fetch lead source data');
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="p-8 space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6" />
          <div className="h-64 bg-gray-100 rounded mb-6" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">
          Failed to load lead source data: {error || 'No data'}
        </div>
      </div>
    );
  }

  const filteredSources = selectedSource
    ? data.sources.filter((s) => s.leadSource === selectedSource)
    : data.sources;

  // Calculate max stage value for chart scaling
  const maxStageValue = Math.max(
    ...filteredSources.map((s) => Math.max(...STAGE_KEYS.map((k) => s.stages[k]))),
    1
  );

  // Source color map
  const sourceColorMap = new Map<string, string>();
  data.sources.forEach((s, i) => {
    sourceColorMap.set(s.leadSource, SOURCE_COLORS[i % SOURCE_COLORS.length]);
  });

  // Drill-down helpers
  function openSourceDrillDown(leadSource: string) {
    const deals = data!.deals.filter((d) => d.leadSource === leadSource);
    setDrillDown({ title: `${leadSource} — All Deals`, deals });
  }

  function openStageDrillDown(leadSource: string, stage: StageKey) {
    const deals = data!.deals.filter(
      (d) => d.leadSource === leadSource && d.stages[stage] !== null
    );
    setDrillDown({
      title: `${leadSource} — ${STAGE_CONFIG[stage].label}`,
      deals,
    });
  }

  // Trend chart data
  const trendSources = selectedSource
    ? [selectedSource]
    : data.sources.map((s) => s.leadSource);

  const maxTrendValue = Math.max(
    ...data.trend.map((w) => {
      if (selectedSource) return w.sources[selectedSource] || 0;
      return w.total;
    }),
    1
  );

  return (
    <div className="p-8 space-y-6">
      {/* Date Range Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="text-sm font-medium text-gray-700">To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">
            {data.totalDeals} deals
          </span>
        </div>
      </div>

      {/* Source Filter Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedSource(null)}
          className={`px-3 py-1 text-xs font-medium rounded-full transition ${
            selectedSource === null
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All Sources
        </button>
        {data.sources.map((s) => (
          <button
            key={s.leadSource}
            onClick={() =>
              setSelectedSource(selectedSource === s.leadSource ? null : s.leadSource)
            }
            className={`px-3 py-1 text-xs font-medium rounded-full transition ${
              selectedSource === s.leadSource
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.leadSource} ({s.totalDeals})
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          label="Total Deals"
          value={String(selectedSource ? filteredSources[0]?.totalDeals || 0 : data.totalDeals)}
        />
        <SummaryCard
          label="Closed Won"
          value={String(selectedSource ? filteredSources[0]?.stages.closedWon || 0 : data.totalClosedWon)}
          color="text-emerald-600"
        />
        <SummaryCard
          label="Total Amount"
          value={formatCurrency(selectedSource ? filteredSources[0]?.totalAmount || 0 : data.totalAmount)}
        />
        <SummaryCard
          label="Win Rate"
          value={formatPercent(selectedSource ? filteredSources[0]?.conversionRates.overallWinRate || 0 : data.overallWinRate)}
          color="text-indigo-600"
        />
      </div>

      {/* Grouped Bar Chart — Pipeline Progression */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Progression by Source</h3>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-4">
          {STAGE_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${STAGE_CONFIG[key].color}`} />
              <span className="text-xs text-gray-600">{STAGE_CONFIG[key].label}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="flex items-end gap-4 h-56">
          {filteredSources.map((source) => (
            <button
              key={source.leadSource}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => openSourceDrillDown(source.leadSource)}
              title={`Click to view ${source.leadSource} deals`}
            >
              <div className="w-full flex items-end justify-center gap-0.5 h-48">
                {STAGE_KEYS.map((key) => (
                  <Bar
                    key={key}
                    value={source.stages[key]}
                    maxValue={maxStageValue}
                    color={STAGE_CONFIG[key].color}
                  />
                ))}
              </div>
              <div className="text-xs font-medium text-gray-600 text-center truncate w-full" title={source.leadSource}>
                {source.leadSource}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Source Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-700">Source</th>
                <th className="px-4 py-3 font-medium text-gray-700 text-right">Deals</th>
                <th className="px-4 py-3 font-medium text-gray-700 text-right">Amount</th>
                {STAGE_KEYS.map((key) => (
                  <th key={key} className="px-4 py-3 font-medium text-gray-700 text-right">
                    {STAGE_CONFIG[key].label}
                  </th>
                ))}
                <th className="px-4 py-3 font-medium text-gray-700 text-right">Win Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSources.map((source) => (
                <tr key={source.leadSource} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{source.leadSource}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="text-gray-700 hover:text-indigo-600 hover:underline cursor-pointer font-medium"
                      onClick={() => openSourceDrillDown(source.leadSource)}
                    >
                      {source.totalDeals}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(source.totalAmount)}</td>
                  {STAGE_KEYS.map((key) => (
                    <td key={key} className="px-4 py-3 text-right">
                      {source.stages[key] > 0 ? (
                        <button
                          className={`${STAGE_CONFIG[key].textColor} hover:underline cursor-pointer font-medium`}
                          onClick={() => openStageDrillDown(source.leadSource, key)}
                        >
                          {source.stages[key]}
                        </button>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatPercent(source.conversionRates.overallWinRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deal Creation Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Deal Creation Trend</h3>

        {/* Legend */}
        {!selectedSource && (
          <div className="flex flex-wrap gap-4 mb-4">
            {data.sources.map((s) => (
              <div key={s.leadSource} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded ${sourceColorMap.get(s.leadSource)}`} />
                <span className="text-xs text-gray-600">{s.leadSource}</span>
              </div>
            ))}
          </div>
        )}
        {selectedSource && (
          <div className="flex items-center gap-1.5 mb-4">
            <div className={`w-3 h-3 rounded ${sourceColorMap.get(selectedSource)}`} />
            <span className="text-xs text-gray-600">{selectedSource}</span>
          </div>
        )}

        {/* Stacked bar chart */}
        <div className="flex items-end gap-1 h-48">
          {data.trend.map((week) => {
            const weekTotal = selectedSource
              ? (week.sources[selectedSource] || 0)
              : week.total;

            return (
              <div key={week.weekStart} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse items-center h-40 relative group">
                  {selectedSource ? (
                    <div
                      className={`w-full rounded-t ${sourceColorMap.get(selectedSource) || 'bg-gray-400'}`}
                      style={{
                        height: `${weekTotal > 0 ? Math.max((weekTotal / maxTrendValue) * 100, 3) : 0}%`,
                      }}
                    />
                  ) : (
                    // Stacked bars for all sources
                    trendSources.map((src) => {
                      const count = week.sources[src] || 0;
                      if (count === 0) return null;
                      const height = (count / maxTrendValue) * 100;
                      return (
                        <div
                          key={src}
                          className={`w-full ${sourceColorMap.get(src) || 'bg-gray-400'}`}
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                      );
                    })
                  )}
                  {/* Hover tooltip */}
                  {weekTotal > 0 && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10">
                      {weekTotal}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  {week.weekLabel}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drill-Down Modal */}
      <LeadSourceDealsModal
        isOpen={drillDown !== null}
        onClose={() => setDrillDown(null)}
        title={drillDown?.title || ''}
        deals={drillDown?.deals || []}
      />
    </div>
  );
}

function Bar({
  value,
  maxValue,
  color,
}: {
  value: number;
  maxValue: number;
  color: string;
}) {
  const height = value > 0 ? Math.max((value / maxValue) * 100, 4) : 0;

  return (
    <div
      className={`w-2 rounded-t transition-all ${color} relative group`}
      style={{ height: `${height}%` }}
    >
      {value > 0 && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10">
          {value}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = 'text-gray-900',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
