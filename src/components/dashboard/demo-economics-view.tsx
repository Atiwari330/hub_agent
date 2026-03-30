'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ── Types ──

interface DemoEconomicsData {
  quarter: { year: number; quarter: number; label: string; startDate: string; endDate: string };
  progress: { daysElapsed: number; totalDays: number; percentComplete: number; currentWeek: number; totalWeeks: number };
  target: { revenueTarget: number; closedWon: number; closedWonCount: number; attainmentPct: number };
  economics: {
    avgDealSize: number;
    closeRate: number;
    scheduledToCompletedRate: number;
    dealsNeededToClose: number;
    demosCompletedNeeded: number;
    demosScheduledNeeded: number;
  };
  actuals: { demosScheduled: number; demosCompleted: number; closedWon: number };
  weeklyPace: {
    requiredPerWeek: number;
    weeks: Array<{
      weekNumber: number;
      weekStart: string;
      weekEnd: string;
      demosScheduled: number;
      demosCompleted: number;
      isCurrent: boolean;
      isFuture: boolean;
    }>;
    cumulativeScheduled: number;
    cumulativeNeededByNow: number;
  };
  funnel: {
    demoScheduled: number;
    demoCompleted: number;
    closedWon: number;
    closedWonRevenue: number;
    scheduledToCompletedPct: number;
    completedToWonPct: number;
  };
  benchmarks: { saasAvg: number; smb: number; topPerformer: number; source: string };
}

// ── Helpers ──

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function pct1(n: number): string {
  return `${n.toFixed(1)}%`;
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Sub-components ──

function HeadlineCard({ data }: { data: DemoEconomicsData }) {
  const { target, actuals, economics, benchmarks } = data;
  const attainPct = Math.min(target.attainmentPct, 100);
  const gap = economics.demosScheduledNeeded - actuals.demosScheduled;
  const gapPct = economics.demosScheduledNeeded > 0
    ? ((gap / economics.demosScheduledNeeded) * 100)
    : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Revenue Target */}
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Revenue Target</div>
          <div className="text-3xl font-bold text-gray-900">{fmt(target.revenueTarget)}</div>
          <div className="text-sm text-gray-500 mt-1">
            {fmtFull(target.closedWon)} closed ({pct(target.attainmentPct)})
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${attainPct < 50 ? 'bg-red-500' : attainPct < 80 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${Math.max(attainPct, 1)}%` }}
            />
          </div>
        </div>

        {/* Demo Volume */}
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Demos Delivered</div>
          <div className="text-3xl font-bold text-gray-900">
            {actuals.demosScheduled} <span className="text-lg font-normal text-gray-400">sched</span>{' '}
            / {actuals.demosCompleted} <span className="text-lg font-normal text-gray-400">comp</span>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            ~{economics.demosScheduledNeeded} scheduled needed at {pct(economics.closeRate * 100)} close rate
          </div>
        </div>

        {/* Close Rate */}
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Close Rate (Demo → Won)</div>
          <div className={`text-3xl font-bold ${economics.closeRate >= benchmarks.saasAvg ? 'text-green-600' : 'text-amber-600'}`}>
            {pct1(economics.closeRate * 100)}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {economics.closeRate >= benchmarks.saasAvg ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                Above industry avg
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                Below industry avg
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-1.5">
            Industry avg: {pct(benchmarks.saasAvg * 100)} (B2B SaaS) · Top: {pct(benchmarks.topPerformer * 100)}+
          </div>
          <div className="text-xs text-gray-400">
            Source: {benchmarks.source}
          </div>
        </div>
      </div>
    </div>
  );
}

function MathChain({ data }: { data: DemoEconomicsData }) {
  const { target, economics, actuals } = data;

  const steps: Array<{ label: string; value: string; sub?: string; highlight?: boolean; op?: string }> = [
    { label: 'Target ARR', value: fmt(target.revenueTarget) },
    { label: 'Avg Deal Size', value: fmt(economics.avgDealSize), op: '÷' },
    { label: 'Wins Needed', value: String(economics.dealsNeededToClose), op: '=' },
    { label: 'Close Rate', value: pct1(economics.closeRate * 100), op: '÷' },
    { label: 'Demos Comp. Needed', value: String(economics.demosCompletedNeeded), sub: `actual: ${actuals.demosCompleted}`, op: '=' },
    { label: 'Sched→Comp Rate', value: pct(economics.scheduledToCompletedRate * 100), op: '÷' },
    { label: 'Demos Sched. Needed', value: String(economics.demosScheduledNeeded), sub: `actual: ${actuals.demosScheduled}`, highlight: true, op: '=' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">The Math — How Many Demos We Need</div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            {step.op && (
              <div className="flex-shrink-0 text-gray-400 text-lg font-light px-1">{step.op}</div>
            )}
            <div
              className={`flex-shrink-0 rounded-lg px-4 py-3 text-center min-w-[90px] ${
                step.highlight
                  ? 'border-2 border-red-400 bg-red-50'
                  : 'border border-gray-200 bg-gray-50'
              }`}
            >
              <div className={`text-lg font-bold ${step.highlight ? 'text-red-700' : 'text-gray-900'}`}>
                {step.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{step.label}</div>
              {step.sub && (
                <div className={`text-xs mt-0.5 ${step.highlight ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                  {step.sub}
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function WeeklyPaceChart({ data }: { data: DemoEconomicsData }) {
  const { weeklyPace } = data;
  const { weeks, requiredPerWeek, cumulativeScheduled, cumulativeNeededByNow } = weeklyPace;

  if (weeks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Weekly Demo Pace</div>
        <div className="text-sm text-gray-400">No weekly snapshot data available. Run the Demo Tracker refresh to populate.</div>
      </div>
    );
  }

  const maxVal = Math.max(requiredPerWeek, ...weeks.map((w) => w.demosScheduled), 1);
  const avgScheduled =
    weeks.filter((w) => !w.isFuture).length > 0
      ? weeks.filter((w) => !w.isFuture).reduce((s, w) => s + w.demosScheduled, 0) /
        weeks.filter((w) => !w.isFuture).length
      : 0;

  const behindAhead = cumulativeScheduled - cumulativeNeededByNow;
  const behindLabel =
    behindAhead < 0
      ? `${Math.abs(behindAhead)} behind pace`
      : behindAhead > 0
        ? `${behindAhead} ahead of pace`
        : 'on pace';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Weekly Demo Pace</div>
        <div className="text-xs text-gray-400">
          Avg: {avgScheduled.toFixed(1)}/wk vs {requiredPerWeek.toFixed(1)} needed
        </div>
      </div>

      {/* Bar chart */}
      <div className="relative">
        {/* Pace line */}
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-red-300 z-10"
          style={{ bottom: `${(requiredPerWeek / maxVal) * 100}%` }}
        >
          <span className="absolute -top-4 right-0 text-xs text-red-400 font-medium">
            {requiredPerWeek.toFixed(0)}/wk needed
          </span>
        </div>

        <div className="flex items-end gap-1.5 h-36">
          {weeks.map((w) => {
            const heightPct = maxVal > 0 ? (w.demosScheduled / maxVal) * 100 : 0;
            return (
              <div key={w.weekNumber} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs text-gray-500 font-medium">{w.demosScheduled || ''}</div>
                <div className="w-full relative" style={{ height: '100px' }}>
                  <div
                    className={`absolute bottom-0 w-full rounded-t transition-all ${
                      w.isFuture
                        ? 'bg-gray-100'
                        : w.isCurrent
                          ? 'bg-indigo-400'
                          : 'bg-indigo-500'
                    }`}
                    style={{ height: `${Math.max(heightPct, w.isFuture ? 0 : 2)}%` }}
                  />
                </div>
                <div className={`text-xs ${w.isCurrent ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
                  {formatWeekLabel(w.weekStart)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-500">
        Through week {data.progress.currentWeek}: <span className="font-medium">{cumulativeScheduled} scheduled</span> (need {cumulativeNeededByNow} to be on pace) —{' '}
        <span className={behindAhead < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
          {behindLabel}
        </span>
      </div>
    </div>
  );
}

function ConversionFunnel({ data }: { data: DemoEconomicsData }) {
  const { funnel } = data;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-4">Conversion Funnel</div>
      <div className="flex items-center gap-3">
        {/* Demo Scheduled */}
        <div className="flex-1 bg-indigo-500 text-white rounded-lg py-3 px-4 text-center">
          <div className="text-xl font-bold">{funnel.demoScheduled}</div>
          <div className="text-xs opacity-80">Demo Scheduled</div>
        </div>

        {/* Arrow + rate */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="text-xs font-medium text-gray-500">{pct1(funnel.scheduledToCompletedPct)}</div>
          <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* Demo Completed */}
        <div className="flex-1 bg-blue-500 text-white rounded-lg py-3 px-4 text-center">
          <div className="text-xl font-bold">{funnel.demoCompleted}</div>
          <div className="text-xs opacity-80">Demo Completed</div>
        </div>

        {/* Arrow + rate */}
        <div className="flex flex-col items-center flex-shrink-0">
          <div className="text-xs font-medium text-gray-500">{pct1(funnel.completedToWonPct)}</div>
          <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* Closed Won */}
        <div className="flex-1 bg-green-500 text-white rounded-lg py-3 px-4 text-center">
          <div className="text-xl font-bold">{funnel.closedWon}</div>
          <div className="text-xs opacity-80">Closed Won</div>
          <div className="text-xs font-medium mt-0.5">{fmtFull(funnel.closedWonRevenue)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──

export function DemoEconomicsView() {
  const [data, setData] = useState<DemoEconomicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/demo-economics?year=2026&quarter=1');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-40 bg-gray-200 rounded-xl animate-pulse" />
        <div className="h-24 bg-gray-200 rounded-xl animate-pulse" />
        <div className="h-40 bg-gray-200 rounded-xl animate-pulse" />
        <div className="h-20 bg-gray-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          Failed to load data: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const qStart = new Date(data.quarter.startDate);
  const qEnd = new Date(data.quarter.endDate);
  const dateRange = `${qStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${qEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold text-gray-900">Demo Economics — {data.quarter.label}</h1>
        <span className="text-sm text-gray-400">{dateRange}</span>
      </div>

      {/* Section A: Headline Numbers */}
      <HeadlineCard data={data} />

      {/* Section B: The Math Chain */}
      <MathChain data={data} />

      {/* Section C: Weekly Pace */}
      <WeeklyPaceChart data={data} />

      {/* Section D: Conversion Funnel */}
      <ConversionFunnel data={data} />
    </div>
  );
}
