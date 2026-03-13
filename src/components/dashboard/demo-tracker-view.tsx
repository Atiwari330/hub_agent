'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getCurrentQuarter } from '@/lib/utils/quarter';

// ── Types ──

interface AEMetrics {
  ownerId: string;
  ownerName: string;
  demosScheduled: number;
  demosCompleted: number;
}

interface WeekData {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  team: { demosScheduled: number; demosCompleted: number };
  byAE: AEMetrics[];
}

interface DemoTrackerData {
  quarter: { year: number; quarter: number; label: string };
  lastComputed: string | null;
  weeks: WeekData[];
}

// ── Helpers ──

function isCurrentWeek(weekStart: string, weekEnd: string): boolean {
  const now = new Date();
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(weekEnd + 'T23:59:59');
  return now >= start && now <= end;
}

function isFutureWeek(weekStart: string): boolean {
  const now = new Date();
  const start = new Date(weekStart + 'T00:00:00');
  return start > now;
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Component ──

export function DemoTrackerView() {
  const [data, setData] = useState<DemoTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(getCurrentQuarter().year);
  const [selectedQuarter, setSelectedQuarter] = useState<number>(getCurrentQuarter().quarter);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/demo-tracker?year=${selectedYear}&quarter=${selectedQuarter}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedQuarter]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/cron/demo-tracker?year=${selectedYear}&quarter=${selectedQuarter}`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-64" />
          <div className="h-96 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-medium">Error loading Demo Tracker</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-2 text-sm underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data || data.weeks.length === 0) {
    return (
      <div className="p-6">
        <Header
          selectedYear={selectedYear}
          selectedQuarter={selectedQuarter}
          onYearChange={setSelectedYear}
          onQuarterChange={setSelectedQuarter}
          lastComputed={null}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
        <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-8 text-center text-slate-500">
          <p className="text-lg font-medium">No data yet</p>
          <p className="text-sm mt-1">Click Refresh to compute Demo Tracker metrics for this quarter.</p>
        </div>
      </div>
    );
  }

  const { weeks } = data;

  // Collect all unique AEs
  const aeMap = new Map<string, string>();
  for (const week of weeks) {
    for (const ae of week.byAE) {
      if (!aeMap.has(ae.ownerId)) {
        aeMap.set(ae.ownerId, ae.ownerName);
      }
    }
  }
  const aeList = Array.from(aeMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  // Compute totals
  const teamTotals = weeks.reduce(
    (acc, w) => ({
      demosScheduled: acc.demosScheduled + w.team.demosScheduled,
      demosCompleted: acc.demosCompleted + w.team.demosCompleted,
    }),
    { demosScheduled: 0, demosCompleted: 0 }
  );

  return (
    <div className="p-6 max-w-full">
      <Header
        selectedYear={selectedYear}
        selectedQuarter={selectedQuarter}
        onYearChange={setSelectedYear}
        onQuarterChange={setSelectedQuarter}
        lastComputed={data.lastComputed}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      {/* Spreadsheet Table */}
      <div className="mt-6 overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5 text-left font-semibold text-slate-700 min-w-[200px] border-r border-slate-200">
                Metric
              </th>
              {weeks.map((w) => (
                <th
                  key={w.weekNumber}
                  className={`px-3 py-2.5 text-center font-medium min-w-[90px] ${
                    isCurrentWeek(w.weekStart, w.weekEnd)
                      ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-400'
                      : isFutureWeek(w.weekStart)
                        ? 'text-slate-400'
                        : 'text-slate-600'
                  }`}
                >
                  <div>Wk {w.weekNumber}</div>
                  <div className="text-xs font-normal">{formatWeekLabel(w.weekStart)}</div>
                </th>
              ))}
              <th className="px-3 py-2.5 text-center font-semibold text-slate-700 min-w-[90px] border-l border-slate-300 bg-slate-100">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {/* ─── Metric 1: Demos Scheduled ─── */}
            <MetricSection
              title="Demos Scheduled"
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future) return <EmptyCell future />;
                return <CountCell value={w.team.demosScheduled} />;
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future) return <EmptyCell future />;
                return <CountCell value={ae?.demosScheduled || 0} />;
              }}
              renderTotalCell={() => <CountCell value={teamTotals.demosScheduled} />}
              renderAETotalCell={(aeId) => {
                const total = weeks.reduce((acc, w) => {
                  const ae = w.byAE.find((a) => a.ownerId === aeId);
                  return acc + (ae?.demosScheduled || 0);
                }, 0);
                return <CountCell value={total} />;
              }}
            />

            {/* ─── Metric 2: Demos Completed ─── */}
            <MetricSection
              title="Demos Completed"
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future) return <EmptyCell future />;
                return <CountCell value={w.team.demosCompleted} />;
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future) return <EmptyCell future />;
                return <CountCell value={ae?.demosCompleted || 0} />;
              }}
              renderTotalCell={() => <CountCell value={teamTotals.demosCompleted} />}
              renderAETotalCell={(aeId) => {
                const total = weeks.reduce((acc, w) => {
                  const ae = w.byAE.find((a) => a.ownerId === aeId);
                  return acc + (ae?.demosCompleted || 0);
                }, 0);
                return <CountCell value={total} />;
              }}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sub-components ──

function Header({
  selectedYear,
  selectedQuarter,
  onYearChange,
  onQuarterChange,
  lastComputed,
  refreshing,
  onRefresh,
}: {
  selectedYear: number;
  selectedQuarter: number;
  onYearChange: (y: number) => void;
  onQuarterChange: (q: number) => void;
  lastComputed: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Demo Tracker</h2>
        <p className="text-sm text-slate-500 mt-0.5">Weekly deals entering Demo Scheduled and Demo Completed stages</p>
      </div>
      <div className="flex items-center gap-3">
        <select
          value={`${selectedYear}-${selectedQuarter}`}
          onChange={(e) => {
            const [y, q] = e.target.value.split('-').map(Number);
            onYearChange(y);
            onQuarterChange(q);
          }}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          {[2025, 2026, 2027].flatMap((y) =>
            [1, 2, 3, 4].map((q) => (
              <option key={`${y}-${q}`} value={`${y}-${q}`}>
                Q{q} {y}
              </option>
            ))
          )}
        </select>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <svg
            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {refreshing ? 'Computing...' : 'Refresh'}
        </button>

        {lastComputed && (
          <span className="text-xs text-slate-400">
            Last computed: {new Date(lastComputed).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

function MetricSection({
  title,
  weeks,
  aeList,
  renderTeamCell,
  renderAECell,
  renderTotalCell,
  renderAETotalCell,
}: {
  title: string;
  weeks: WeekData[];
  aeList: [string, string][];
  renderTeamCell: (w: WeekData) => React.ReactNode;
  renderAECell: (w: WeekData, aeId: string) => React.ReactNode;
  renderTotalCell: () => React.ReactNode;
  renderAETotalCell: (aeId: string) => React.ReactNode;
}) {
  return (
    <>
      {/* Section header */}
      <tr className="border-t-2 border-slate-300">
        <td
          colSpan={weeks.length + 2}
          className="sticky left-0 z-10 bg-slate-800 text-white px-4 py-2 font-semibold text-sm"
        >
          {title}
        </td>
      </tr>

      {/* Team total row */}
      <tr className="bg-slate-50 border-b border-slate-200">
        <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 font-semibold text-slate-700 border-r border-slate-200">
          Team Total
        </td>
        {weeks.map((w) => (
          <td key={w.weekNumber} className="px-1 py-1.5 text-center">
            {renderTeamCell(w)}
          </td>
        ))}
        <td className="px-1 py-1.5 text-center border-l border-slate-300 bg-slate-100">
          {renderTotalCell()}
        </td>
      </tr>

      {/* Per-AE rows */}
      {aeList.map(([aeId, aeName]) => (
        <tr key={aeId} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="sticky left-0 z-10 bg-white px-4 py-1.5 text-slate-600 text-sm border-r border-slate-200">
            {aeName}
          </td>
          {weeks.map((w) => (
            <td key={w.weekNumber} className="px-1 py-1 text-center">
              {renderAECell(w, aeId)}
            </td>
          ))}
          <td className="px-1 py-1 text-center border-l border-slate-300 bg-slate-50">
            {renderAETotalCell(aeId)}
          </td>
        </tr>
      ))}
    </>
  );
}

function CountCell({ value }: { value: number }) {
  return (
    <div className={`rounded px-2 py-1 text-xs font-medium ${
      value > 0 ? 'bg-blue-100 text-blue-800' : 'text-slate-400'
    }`}>
      {value}
    </div>
  );
}

function EmptyCell({ future }: { future?: boolean }) {
  return (
    <div className={`px-2 py-1 text-xs ${future ? 'text-slate-300' : 'text-slate-400'}`}>
      -
    </div>
  );
}
