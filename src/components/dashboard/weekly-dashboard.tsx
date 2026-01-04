'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/utils/currency';
import Link from 'next/link';
import { AIInsightsButton } from './ai-insights-button';

interface WeekMetrics {
  sqlCount: number;
  demoScheduledCount: number;
  demoCompletedCount: number;
  closedWonCount: number;
  closedWonAmount: number;
  closedLostCount: number;
}

interface WeekData {
  label: string;
  startDate: string;
  metrics: WeekMetrics;
}

interface AEComparison {
  id: string;
  name: string;
  initials: string;
  pipeline: number;
  activeDeals: number;
  winRate: number;
  avgCycle: number | null;
  stalePercent: number;
  status: 'green' | 'amber' | 'red';
}

interface StageVelocity {
  stageId: string;
  stageName: string;
  dealCount: number;
  avgDays: number;
  expectedDays: number;
  status: 'green' | 'amber' | 'red';
}

interface LeadSourcePerformance {
  source: string;
  dealCount: number;
  totalValue: number;
  avgValue: number;
  wonCount: number;
  winRate: number;
}

interface SentimentSummary {
  positive: number;
  neutral: number;
  negative: number;
  notableDeals: { name: string; amount: number; sentiment: string; reason: string }[];
}

interface WeeklySummaryData {
  thisWeek: WeekData;
  lastWeek: WeekData;
  deltas: {
    sqlCount: number;
    demoScheduledCount: number;
    demoCompletedCount: number;
    closedWonCount: number;
    closedWonAmount: number;
    closedLostCount: number;
  };
  aeComparisons: AEComparison[];
  stageVelocity: StageVelocity[];
  leadSourcePerformance: LeadSourcePerformance[];
  sentimentSummary: SentimentSummary;
}

const STATUS_DOT = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

function DeltaIndicator({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) {
    return <span className="text-gray-400">-</span>;
  }

  const isPositive = value > 0;
  return (
    <span className={isPositive ? 'text-emerald-600' : 'text-red-600'}>
      {isPositive ? '+' : ''}{value}{suffix}
    </span>
  );
}

function MetricComparison({
  label,
  thisWeek,
  lastWeek,
  delta,
  format = 'number',
}: {
  label: string;
  thisWeek: number;
  lastWeek: number;
  delta: number;
  format?: 'number' | 'currency';
}) {
  const formatValue = format === 'currency' ? formatCurrency : (v: number) => v.toString();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-semibold text-gray-900">{formatValue(thisWeek)}</div>
        <div className="text-right">
          <div className="text-sm">
            <DeltaIndicator value={delta} suffix={format === 'currency' ? '' : ''} />
          </div>
          <div className="text-xs text-gray-400">vs {formatValue(lastWeek)}</div>
        </div>
      </div>
    </div>
  );
}

export function WeeklyDashboard() {
  const [data, setData] = useState<WeeklySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/dashboard/weekly-summary');
        if (!response.ok) {
          throw new Error('Failed to fetch weekly summary');
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
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
          <div className="h-48 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <h3 className="font-medium">Error loading dashboard</h3>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { thisWeek, lastWeek, deltas, aeComparisons, stageVelocity, leadSourcePerformance, sentimentSummary } = data;
  const totalSentiment = sentimentSummary.positive + sentimentSummary.neutral + sentimentSummary.negative;

  // Prepare data for AI insights
  const insightsData = {
    thisWeek,
    lastWeek,
    deltas,
    aeComparisons,
    stageVelocity,
    sentimentSummary,
  };

  return (
    <div className="p-8 bg-gray-50 min-h-full space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Weekly Tactical Review</h2>
          <p className="text-sm text-gray-500">{thisWeek.label} vs {lastWeek.label}</p>
        </div>
        <AIInsightsButton dashboardType="weekly" dashboardData={insightsData} />
      </div>

      {/* Pipeline Movement - Week over Week */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Pipeline Movement (This Week vs Last)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricComparison
            label="New SQLs"
            thisWeek={thisWeek.metrics.sqlCount}
            lastWeek={lastWeek.metrics.sqlCount}
            delta={deltas.sqlCount}
          />
          <MetricComparison
            label="Demos Scheduled"
            thisWeek={thisWeek.metrics.demoScheduledCount}
            lastWeek={lastWeek.metrics.demoScheduledCount}
            delta={deltas.demoScheduledCount}
          />
          <MetricComparison
            label="Demos Completed"
            thisWeek={thisWeek.metrics.demoCompletedCount}
            lastWeek={lastWeek.metrics.demoCompletedCount}
            delta={deltas.demoCompletedCount}
          />
          <MetricComparison
            label="Deals Won"
            thisWeek={thisWeek.metrics.closedWonCount}
            lastWeek={lastWeek.metrics.closedWonCount}
            delta={deltas.closedWonCount}
          />
          <MetricComparison
            label="Revenue Won"
            thisWeek={thisWeek.metrics.closedWonAmount}
            lastWeek={lastWeek.metrics.closedWonAmount}
            delta={deltas.closedWonAmount}
            format="currency"
          />
          <MetricComparison
            label="Deals Lost"
            thisWeek={thisWeek.metrics.closedLostCount}
            lastWeek={lastWeek.metrics.closedLostCount}
            delta={deltas.closedLostCount}
          />
        </div>
      </div>

      {/* AE Comparison Matrix */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">AE Comparison Matrix</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 font-medium text-gray-500">AE</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Pipeline</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Active Deals</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Win Rate</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Avg Cycle</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Stale %</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {aeComparisons.map((ae) => (
                <tr key={ae.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-2">
                    <Link href={`/dashboard/ae/${ae.id}`} className="flex items-center gap-2 hover:text-indigo-600">
                      <span className="w-7 h-7 rounded-full bg-slate-700 text-white text-xs flex items-center justify-center">
                        {ae.initials}
                      </span>
                      <span className="font-medium">{ae.name}</span>
                    </Link>
                  </td>
                  <td className="text-right py-3 px-2 font-medium">{formatCurrency(ae.pipeline)}</td>
                  <td className="text-right py-3 px-2">{ae.activeDeals}</td>
                  <td className={`text-right py-3 px-2 ${ae.winRate >= 30 ? 'text-emerald-600' : ae.winRate >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                    {formatPercent(ae.winRate)}
                  </td>
                  <td className={`text-right py-3 px-2 ${!ae.avgCycle ? 'text-gray-400' : ae.avgCycle <= 40 ? 'text-emerald-600' : ae.avgCycle <= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {ae.avgCycle ? `${ae.avgCycle}d` : '-'}
                  </td>
                  <td className={`text-right py-3 px-2 ${ae.stalePercent <= 10 ? 'text-emerald-600' : ae.stalePercent <= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                    {formatPercent(ae.stalePercent)}
                  </td>
                  <td className="text-center py-3 px-2">
                    <span className={`inline-block w-3 h-3 rounded-full ${STATUS_DOT[ae.status]}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two Column: Stage Velocity & Lead Source */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stage Velocity */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Stage Velocity</h3>
          <p className="text-xs text-gray-500 mb-4">Where deals are getting stuck (avg days vs expected)</p>

          <div className="space-y-3">
            {stageVelocity.map((stage) => (
              <div key={stage.stageId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[stage.status]}`} />
                  <span className="font-medium text-gray-900">{stage.stageName}</span>
                  <span className="text-xs text-gray-500">({stage.dealCount} deals)</span>
                </div>
                <div className="text-right">
                  <span className={`font-medium ${stage.status === 'green' ? 'text-gray-900' : stage.status === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
                    {stage.avgDays}d
                  </span>
                  <span className="text-xs text-gray-400 ml-1">/ {stage.expectedDays}d</span>
                </div>
              </div>
            ))}

            {stageVelocity.length === 0 && (
              <p className="text-sm text-gray-500 italic">No active pipeline stages</p>
            )}
          </div>
        </div>

        {/* Lead Source Performance */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Lead Source Performance</h3>

          <div className="space-y-3">
            {leadSourcePerformance.map((source) => (
              <div key={source.source} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <div className="font-medium text-gray-900">{source.source}</div>
                  <div className="text-xs text-gray-500">
                    {source.dealCount} deals &bull; {source.wonCount} won ({formatPercent(source.winRate)})
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{formatCurrency(source.totalValue)}</div>
                  <div className="text-xs text-gray-500">avg {formatCurrency(source.avgValue)}</div>
                </div>
              </div>
            ))}

            {leadSourcePerformance.length === 0 && (
              <p className="text-sm text-gray-500 italic">No lead source data</p>
            )}
          </div>
        </div>
      </div>

      {/* Sentiment Distribution */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Sentiment Distribution</h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Sentiment Bars */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Positive</span>
              <span className="font-medium text-emerald-600">{sentimentSummary.positive}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: totalSentiment > 0 ? `${(sentimentSummary.positive / totalSentiment) * 100}%` : '0%' }}
              />
            </div>

            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-600">Neutral</span>
              <span className="font-medium text-gray-600">{sentimentSummary.neutral}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gray-400 rounded-full"
                style={{ width: totalSentiment > 0 ? `${(sentimentSummary.neutral / totalSentiment) * 100}%` : '0%' }}
              />
            </div>

            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-600">Negative</span>
              <span className="font-medium text-red-600">{sentimentSummary.negative}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full"
                style={{ width: totalSentiment > 0 ? `${(sentimentSummary.negative / totalSentiment) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {/* Notable Deals */}
          <div className="md:col-span-3">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Notable Negative Sentiment Deals</h4>
            {sentimentSummary.notableDeals.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No high-value deals with negative sentiment</p>
            ) : (
              <div className="space-y-2">
                {sentimentSummary.notableDeals.map((deal, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div className="font-medium text-red-800">{deal.name}</div>
                      <div className="text-sm font-medium text-red-700">{formatCurrency(deal.amount)}</div>
                    </div>
                    <p className="text-xs text-red-600 mt-1">{deal.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
