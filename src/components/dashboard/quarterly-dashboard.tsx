'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/utils/currency';
import Link from 'next/link';

interface QuarterInfo {
  year: number;
  quarter: number;
  label: string;
}

interface AEContribution {
  id: string;
  name: string;
  email: string;
  initials: string;
  target: number;
  closedWon: number;
  attainment: number;
  pipeline: number;
  coverage: number;
  stalePercent: number;
  status: 'on_track' | 'at_risk' | 'behind';
}

interface StageBreakdown {
  stageId: string;
  stageName: string;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  weight: number;
}

interface RiskFactor {
  description: string;
  impact: number;
  dealCount: number;
  deals: string[];
}

interface QuarterlySummaryData {
  quarter: QuarterInfo;
  progress: {
    daysElapsed: number;
    totalDays: number;
    percentComplete: number;
  };
  target: {
    total: number;
    closedWon: number;
    attainment: number;
    remaining: number;
  };
  pace: {
    expectedByNow: number;
    actual: number;
    difference: number;
    onTrack: boolean;
  };
  forecast: {
    weighted: number;
    attainment: number;
    confidence: 'high' | 'medium' | 'low';
  };
  pipeline: {
    total: number;
    weighted: number;
    coverage: number;
    coverageStatus: 'healthy' | 'watch' | 'at_risk';
  };
  aeContributions: AEContribution[];
  stageBreakdown: StageBreakdown[];
  riskFactors: RiskFactor[];
}

const STATUS_STYLES = {
  on_track: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'On Track' },
  at_risk: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'At Risk' },
  behind: { bg: 'bg-red-100', text: 'text-red-800', label: 'Behind' },
};

const COVERAGE_STYLES = {
  healthy: { color: 'text-emerald-600', label: '3x+ Coverage' },
  watch: { color: 'text-amber-600', label: '2-3x Coverage' },
  at_risk: { color: 'text-red-600', label: '<2x Coverage' },
};

const CONFIDENCE_STYLES = {
  high: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800' },
  low: { bg: 'bg-red-100', text: 'text-red-800' },
};

export function QuarterlyDashboard() {
  const [data, setData] = useState<QuarterlySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/dashboard/quarterly-summary');
        if (!response.ok) {
          throw new Error('Failed to fetch quarterly summary');
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
          <div className="h-32 bg-gray-200 rounded-xl"></div>
          <div className="grid grid-cols-2 gap-6">
            <div className="h-48 bg-gray-200 rounded-xl"></div>
            <div className="h-48 bg-gray-200 rounded-xl"></div>
          </div>
          <div className="h-64 bg-gray-200 rounded-xl"></div>
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

  const { quarter, progress, target, pace, forecast, pipeline, aeContributions, stageBreakdown, riskFactors } = data;

  return (
    <div className="p-8 bg-gray-50 min-h-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Strategic Dashboard</h2>
          <p className="text-sm text-gray-500">
            {quarter.label} &bull; Day {progress.daysElapsed} of {progress.totalDays}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium ${pace.onTrack ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {pace.onTrack ? 'On Pace' : 'Needs Attention'}
        </div>
      </div>

      {/* Hero Banner - Target Progress */}
      <div className={`rounded-xl p-6 ${pace.onTrack ? 'bg-emerald-600' : 'bg-amber-600'} text-white`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm opacity-80">Target Progress</div>
            <div className="text-3xl font-bold">{formatPercent(target.attainment)}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">{formatCurrency(target.closedWon)}</div>
            <div className="text-sm opacity-80">of {formatCurrency(target.total)}</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-3 bg-white/20 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-white rounded-full transition-all"
            style={{ width: `${Math.min(100, target.attainment)}%` }}
          />
        </div>

        <div className="flex justify-between text-sm">
          <span>{formatCurrency(target.remaining)} remaining</span>
          <span>
            {pace.onTrack
              ? `${formatCurrency(Math.abs(pace.difference))} ahead of pace`
              : `${formatCurrency(Math.abs(pace.difference))} behind pace`}
          </span>
        </div>
      </div>

      {/* Forecast & Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Forecast Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Weighted Forecast</h3>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Closed Won (100%)</span>
              <span className="font-medium">{formatCurrency(target.closedWon)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-gray-600">Pipeline (weighted)</span>
              <span className="font-medium">{formatCurrency(pipeline.weighted)}</span>
            </div>
            <div className="flex justify-between items-center py-2 pt-3">
              <span className="font-semibold text-gray-900">Forecast Total</span>
              <div className="text-right">
                <span className="text-xl font-bold text-gray-900">{formatCurrency(forecast.weighted)}</span>
                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${CONFIDENCE_STYLES[forecast.confidence].bg} ${CONFIDENCE_STYLES[forecast.confidence].text}`}>
                  {forecast.attainment}% of target
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Pipeline Coverage Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Coverage</h3>

          <div className="text-center mb-4">
            <div className={`text-4xl font-bold ${COVERAGE_STYLES[pipeline.coverageStatus].color}`}>
              {pipeline.coverage}x
            </div>
            <div className="text-sm text-gray-500">{COVERAGE_STYLES[pipeline.coverageStatus].label}</div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Pipeline</span>
              <span className="font-medium">{formatCurrency(pipeline.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Remaining Target</span>
              <span className="font-medium">{formatCurrency(target.remaining)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400 pt-2">
              <span>Coverage = Pipeline / Remaining</span>
              <span>Goal: 3x+</span>
            </div>
          </div>
        </div>
      </div>

      {/* AE Contribution Table */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">AE Contribution</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 font-medium text-gray-500">AE</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Target</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Closed</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Attainment</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Pipeline</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Coverage</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Stale %</th>
                <th className="text-center py-3 px-2 font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {aeContributions.map((ae) => {
                const statusStyle = STATUS_STYLES[ae.status];
                return (
                  <tr key={ae.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-2">
                      <Link href={`/dashboard/ae/${ae.id}`} className="flex items-center gap-2 hover:text-indigo-600">
                        <span className="w-7 h-7 rounded-full bg-slate-700 text-white text-xs flex items-center justify-center">
                          {ae.initials}
                        </span>
                        <span className="font-medium">{ae.name}</span>
                      </Link>
                    </td>
                    <td className="text-right py-3 px-2">{formatCurrency(ae.target)}</td>
                    <td className="text-right py-3 px-2 font-medium">{formatCurrency(ae.closedWon)}</td>
                    <td className="text-right py-3 px-2">{formatPercent(ae.attainment)}</td>
                    <td className="text-right py-3 px-2">{formatCurrency(ae.pipeline)}</td>
                    <td className={`text-right py-3 px-2 font-medium ${ae.coverage >= 3 ? 'text-emerald-600' : ae.coverage >= 2 ? 'text-amber-600' : 'text-red-600'}`}>
                      {ae.coverage}x
                    </td>
                    <td className={`text-right py-3 px-2 ${ae.stalePercent > 20 ? 'text-red-600' : ae.stalePercent > 10 ? 'text-amber-600' : 'text-gray-600'}`}>
                      {formatPercent(ae.stalePercent)}
                    </td>
                    <td className="text-center py-3 px-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-column: Pipeline by Stage & Risk Factors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pipeline by Stage */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Pipeline by Stage</h3>

          <div className="space-y-3">
            {stageBreakdown.slice(0, 6).map((stage) => (
              <div key={stage.stageId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <div className="font-medium text-gray-900">{stage.stageName}</div>
                  <div className="text-xs text-gray-500">{stage.dealCount} deals &bull; {Math.round(stage.weight * 100)}% weight</div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{formatCurrency(stage.totalValue)}</div>
                  <div className="text-xs text-gray-500">→ {formatCurrency(stage.weightedValue)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Factors */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Risk Factors</h3>

          {riskFactors.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">&#10003;</div>
              <p className="text-gray-500">No significant risk factors identified</p>
            </div>
          ) : (
            <div className="space-y-3">
              {riskFactors.map((risk, idx) => (
                <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-red-800">{risk.description}</div>
                    <div className="text-sm font-medium text-red-700">{formatCurrency(risk.impact)}</div>
                  </div>
                  <div className="text-xs text-red-600 mt-1">
                    {risk.deals.slice(0, 3).join(', ')}
                    {risk.deals.length > 3 && ` +${risk.deals.length - 3} more`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
