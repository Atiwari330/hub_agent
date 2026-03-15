'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getCurrentQuarter } from '@/lib/utils/quarter';
import { PplDrillDownModal } from './ppl-drill-down-modal';
import { StageDealsDrillDownModal } from './stage-deals-drill-down-modal';
import { LeadingMetricDrillDownModal } from './leading-metric-drill-down-modal';

// ── Types ──

interface AEMetrics {
  ownerId: string;
  ownerName: string;
  sqlContactedPct: number;
  sqlContacted: number;
  sqlTotal: number;
  callsToSqlWithPhone: number;
  proposalWithGift: number;
  proposalTotal: number;
  pplTouchesAvg: number;
  pplTouchesTotal: number;
  pplDealsCount: number;
  pplComplianceDealsCount: number;
  pplComplianceAvg: number;
  pplComplianceSum: number;
  pplCallComplianceDealsCount: number;
  pplCallComplianceAvg: number;
  pplCallComplianceSum: number;
}

interface TeamMetrics {
  sqlContactedPct: number;
  sqlContacted: number;
  sqlTotal: number;
  callsToSqlWithPhone: number;
  proposalWithGift: number;
  proposalTotal: number;
  sqlDealDetails: unknown[];
  pplTouchesAvg: number;
  pplTouchesTotal: number;
  pplDealsCount: number;
  pplComplianceDealsCount: number;
  pplComplianceAvg: number;
  pplComplianceSum: number;
  pplCallComplianceDealsCount: number;
  pplCallComplianceAvg: number;
  pplCallComplianceSum: number;
}

interface WeekData {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  team: TeamMetrics;
  byAE: AEMetrics[];
}

interface HotTrackerData {
  quarter: { year: number; quarter: number; label: string };
  lastComputed: string | null;
  goals: {
    sqlContactedPct: number;
    callsToSqlWithPhone: number;
    proposalWithGift: number;
    pplAvgTouches: number;
    pplDailyCompliance: number;
    pplCallCompliance: number;
  };
  weeks: WeekData[];
}

// ── Stage Counts Types ──

interface StageCounts {
  mqlSql: number;
  demoScheduled: number;
  demoCompleted: number;
}

interface SpeedToDemoData {
  avgDays: number;
  dealCount: number;
}

interface DemoToProposalData {
  converted: number;
  total: number;
  pct: number;
  inProgress: boolean;
}

interface StageCountsAE extends StageCounts {
  ownerId: string;
  ownerName: string;
  speedToDemo: SpeedToDemoData;
  demoToProposal: DemoToProposalData;
}

interface StageCountsWeek {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  team: StageCounts;
  byAE: StageCountsAE[];
  speedToDemo: SpeedToDemoData;
  demoToProposal: DemoToProposalData;
}

interface StageCountsData {
  weeks: StageCountsWeek[];
  goals: StageCounts & { speedToDemo: number; demoToProposal: number };
}

type StageKey = keyof StageCounts;

const STAGE_LABELS: Record<StageKey, string> = {
  mqlSql: 'MQL / SQL Discovery',
  demoScheduled: 'Demo Scheduled',
  demoCompleted: 'Demo Completed',
};

// ── Tooltip descriptions ──

const METRIC_TOOLTIPS: Record<string, string> = {
  sqlContacted: 'Measures how quickly AEs respond to new SQL/Discovery deals. Tracks the % of deals where the first call or email happened within 15 minutes of entering the Discovery stage.',
  callsToSql: 'Counts the number of phone calls made to contacts (who have a phone number) associated with deals in the SQL/Discovery stage or beyond.',
  proposalGift: 'Counts deals created this quarter that have the gift/incentive flag set in HubSpot (any pipeline stage). Shown as gifts sent out of total deals created that week.',
  pplTouches: 'Average number of touches (calls + outbound emails) on Paid Per Lead deals during their first 7 days. Only counts deals where the full first week has elapsed.',
  pplCompliance: 'For Paid Per Lead deals, measures the % of days in the first week where at least 1 touch (call or email) occurred. Excludes deals with meetings already booked.',
  pplCallCompliance: 'For Paid Per Lead deals, measures the % of days in the first week where at least 2 phone calls were made. Excludes deals with meetings booked. Day 0 excluded if deal created after 5pm EST.',
  mqlSql: 'Count of deals entering MQL or SQL/Discovery stage each week. Shows new pipeline entering the top of the funnel.',
  demoScheduled: 'Count of deals entering the Demo Scheduled stage each week. Leading indicator of upcoming demo activity.',
  demoCompleted: 'Count of deals where the demo was completed each week. Shows actual demo execution.',
  speedToDemo: 'Average calendar days from MQL entry (or deal creation if no MQL date) to Demo Scheduled. Measures how quickly leads are being worked through the pipeline. Faster = higher close rates.',
  demoToProposal: 'Of deals completing a demo in a given week, what % moved to Proposal/Evaluating within 14 days. Blue cells indicate the 14-day window hasn\'t elapsed yet. Measures demo quality and deal qualification.',
};

// ── Helpers ──

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pctColor(value: number, goal: number): string {
  const ratio = value / goal;
  if (ratio >= 0.8) return 'bg-green-100 text-green-800';
  if (ratio >= 0.5) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function countColor(value: number, goal: number): string {
  const ratio = value / goal;
  if (ratio >= 0.8) return 'bg-green-100 text-green-800';
  if (ratio >= 0.5) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function daysColor(days: number, goal: number): string {
  if (days <= goal) return 'bg-green-100 text-green-800';
  if (days <= goal * 2) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

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

export function HotTrackerView() {
  const [data, setData] = useState<HotTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(getCurrentQuarter().year);
  const [selectedQuarter, setSelectedQuarter] = useState<number>(getCurrentQuarter().quarter);
  const [pplModal, setPplModal] = useState<{
    weekNumber: number;
    ownerId?: string;
    ownerName?: string;
  } | null>(null);
  const [stageCountsData, setStageCountsData] = useState<StageCountsData | null>(null);
  const [stageDrillModal, setStageDrillModal] = useState<{
    weekNumber: number;
    stage: string;
    stageLabel: string;
    ownerId?: string;
    ownerName?: string;
  } | null>(null);
  const [leadingMetricModal, setLeadingMetricModal] = useState<{
    weekNumber: number;
    metricType: 'speedToDemo' | 'untouchedDeals' | 'demoConversion';
    ownerId?: string;
    ownerName?: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [htRes, scRes] = await Promise.all([
        fetch(`/api/hot-tracker?year=${selectedYear}&quarter=${selectedQuarter}`),
        fetch(`/api/hot-tracker/stage-counts?year=${selectedYear}&quarter=${selectedQuarter}`),
      ]);
      if (!htRes.ok) throw new Error(`Failed to fetch: ${htRes.status}`);
      const json = await htRes.json();
      setData(json);
      if (scRes.ok) {
        const scJson = await scRes.json();
        setStageCountsData(scJson);
      }
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
      await fetch(`/api/cron/hot-tracker?year=${selectedYear}&quarter=${selectedQuarter}`);
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
          <p className="font-medium">Error loading Hot Tracker</p>
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
          <p className="text-sm mt-1">Click Refresh to compute Hot Tracker metrics for this quarter.</p>
        </div>
      </div>
    );
  }

  const { weeks, goals } = data;

  // Collect all unique AEs across all weeks
  const aeMap = new Map<string, string>();
  for (const week of weeks) {
    for (const ae of week.byAE) {
      if (!aeMap.has(ae.ownerId)) {
        aeMap.set(ae.ownerId, ae.ownerName);
      }
    }
  }
  const aeList = Array.from(aeMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  // Compute totals across all weeks
  const teamTotals = weeks.reduce(
    (acc, w) => ({
      sqlContacted: acc.sqlContacted + w.team.sqlContacted,
      sqlTotal: acc.sqlTotal + w.team.sqlTotal,
      callsToSqlWithPhone: acc.callsToSqlWithPhone + w.team.callsToSqlWithPhone,
      proposalWithGift: acc.proposalWithGift + w.team.proposalWithGift,
      proposalTotal: acc.proposalTotal + w.team.proposalTotal,
      pplTouchesTotal: acc.pplTouchesTotal + w.team.pplTouchesTotal,
      pplDealsCount: acc.pplDealsCount + w.team.pplDealsCount,
      pplComplianceDealsCount: acc.pplComplianceDealsCount + (w.team.pplComplianceDealsCount || 0),
      pplComplianceSum: acc.pplComplianceSum + (w.team.pplComplianceSum || 0),
      pplCallComplianceDealsCount: acc.pplCallComplianceDealsCount + (w.team.pplCallComplianceDealsCount || 0),
      pplCallComplianceSum: acc.pplCallComplianceSum + (w.team.pplCallComplianceSum || 0),
    }),
    { sqlContacted: 0, sqlTotal: 0, callsToSqlWithPhone: 0, proposalWithGift: 0, proposalTotal: 0, pplTouchesTotal: 0, pplDealsCount: 0, pplComplianceDealsCount: 0, pplComplianceSum: 0, pplCallComplianceDealsCount: 0, pplCallComplianceSum: 0 }
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

      {/* Goals Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-200 inline-block" />
          {'>'}=80% of goal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-yellow-200 inline-block" />
          50-79% of goal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-200 inline-block" />
          {'<'}50% of goal
        </span>
      </div>

      {/* Spreadsheet Table */}
      <div className="mt-6 overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm">
          {/* Column Headers */}
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
            {/* ─── Metric 1: SQL Contacted within 15 min ─── */}
            <MetricSection
              title="% SQLs Contacted within 15 min"
              goal={`Goal: ${formatPct(goals.sqlContactedPct)}`}
              tooltip={METRIC_TOOLTIPS.sqlContacted}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future || w.team.sqlTotal === 0) return <EmptyCell future={future} />;
                return (
                  <MetricCell
                    value={formatPct(w.team.sqlContactedPct)}
                    sub={`(${w.team.sqlContacted}/${w.team.sqlTotal})`}
                    colorClass={pctColor(w.team.sqlContactedPct, goals.sqlContactedPct)}
                  />
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future || !ae || ae.sqlTotal === 0) return <EmptyCell future={future} />;
                return (
                  <MetricCell
                    value={formatPct(ae.sqlContactedPct)}
                    sub={`(${ae.sqlContacted}/${ae.sqlTotal})`}
                    colorClass={pctColor(ae.sqlContactedPct, goals.sqlContactedPct)}
                  />
                );
              }}
              renderTotalCell={() => {
                if (teamTotals.sqlTotal === 0) return <EmptyCell />;
                const pct = teamTotals.sqlContacted / teamTotals.sqlTotal;
                return (
                  <MetricCell
                    value={formatPct(pct)}
                    sub={`(${teamTotals.sqlContacted}/${teamTotals.sqlTotal})`}
                    colorClass={pctColor(pct, goals.sqlContactedPct)}
                  />
                );
              }}
              renderAETotalCell={(aeId) => {
                const totals = weeks.reduce(
                  (acc, w) => {
                    const ae = w.byAE.find((a) => a.ownerId === aeId);
                    return {
                      contacted: acc.contacted + (ae?.sqlContacted || 0),
                      total: acc.total + (ae?.sqlTotal || 0),
                    };
                  },
                  { contacted: 0, total: 0 }
                );
                if (totals.total === 0) return <EmptyCell />;
                const pct = totals.contacted / totals.total;
                return (
                  <MetricCell
                    value={formatPct(pct)}
                    sub={`(${totals.contacted}/${totals.total})`}
                    colorClass={pctColor(pct, goals.sqlContactedPct)}
                  />
                );
              }}
            />

            {/* ─── Metric 2: Calls to SQLs with Phone ─── */}
            <MetricSection
              title="Calls to SQLs w/ Phone"
              goal={`Goal: ${goals.callsToSqlWithPhone}/wk`}
              tooltip={METRIC_TOOLTIPS.callsToSql}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future) return <EmptyCell future />;
                return (
                  <MetricCell
                    value={String(w.team.callsToSqlWithPhone)}
                    colorClass={countColor(w.team.callsToSqlWithPhone, goals.callsToSqlWithPhone)}
                  />
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future) return <EmptyCell future />;
                return (
                  <MetricCell
                    value={String(ae?.callsToSqlWithPhone || 0)}
                    colorClass={countColor(
                      ae?.callsToSqlWithPhone || 0,
                      goals.callsToSqlWithPhone / Math.max(1, aeList.length) // per-AE share
                    )}
                  />
                );
              }}
              renderTotalCell={() => (
                <MetricCell
                  value={String(teamTotals.callsToSqlWithPhone)}
                  colorClass={countColor(teamTotals.callsToSqlWithPhone, goals.callsToSqlWithPhone * weeks.filter((w) => !isFutureWeek(w.weekStart)).length)}
                />
              )}
              renderAETotalCell={(aeId) => {
                const total = weeks.reduce((acc, w) => {
                  const ae = w.byAE.find((a) => a.ownerId === aeId);
                  return acc + (ae?.callsToSqlWithPhone || 0);
                }, 0);
                return (
                  <MetricCell
                    value={String(total)}
                    colorClass={countColor(
                      total,
                      (goals.callsToSqlWithPhone / Math.max(1, aeList.length)) * weeks.filter((w) => !isFutureWeek(w.weekStart)).length
                    )}
                  />
                );
              }}
            />

            {/* ─── Metric 3: Proposal Deals with Gift ─── */}
            <MetricSection
              title="Deals with Gift/Incentive Sent"
              goal={`Goal: ${goals.proposalWithGift}/wk`}
              tooltip={METRIC_TOOLTIPS.proposalGift}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future) return <EmptyCell future />;
                return (
                  <MetricCell
                    value={String(w.team.proposalWithGift)}
                    sub={w.team.proposalTotal > 0 ? `(${w.team.proposalWithGift}/${w.team.proposalTotal})` : undefined}
                    colorClass={countColor(w.team.proposalWithGift, goals.proposalWithGift)}
                  />
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future) return <EmptyCell future />;
                return (
                  <MetricCell
                    value={String(ae?.proposalWithGift || 0)}
                    sub={ae && ae.proposalTotal > 0 ? `(${ae.proposalWithGift}/${ae.proposalTotal})` : undefined}
                    colorClass={countColor(
                      ae?.proposalWithGift || 0,
                      goals.proposalWithGift / Math.max(1, aeList.length)
                    )}
                  />
                );
              }}
              renderTotalCell={() => (
                <MetricCell
                  value={String(teamTotals.proposalWithGift)}
                  sub={teamTotals.proposalTotal > 0 ? `(${teamTotals.proposalWithGift}/${teamTotals.proposalTotal})` : undefined}
                  colorClass={countColor(teamTotals.proposalWithGift, goals.proposalWithGift * weeks.filter((w) => !isFutureWeek(w.weekStart)).length)}
                />
              )}
              renderAETotalCell={(aeId) => {
                const totals = weeks.reduce(
                  (acc, w) => {
                    const ae = w.byAE.find((a) => a.ownerId === aeId);
                    return {
                      gift: acc.gift + (ae?.proposalWithGift || 0),
                      total: acc.total + (ae?.proposalTotal || 0),
                    };
                  },
                  { gift: 0, total: 0 }
                );
                return (
                  <MetricCell
                    value={String(totals.gift)}
                    sub={totals.total > 0 ? `(${totals.gift}/${totals.total})` : undefined}
                    colorClass={countColor(
                      totals.gift,
                      (goals.proposalWithGift / Math.max(1, aeList.length)) * weeks.filter((w) => !isFutureWeek(w.weekStart)).length
                    )}
                  />
                );
              }}
            />

            {/* ─── Metric 4: Avg PPL First Week Touches ─── */}
            <MetricSection
              title="Avg PPL First Week Touches"
              goal={`Goal: ${goals.pplAvgTouches}/deal`}
              tooltip={METRIC_TOOLTIPS.pplTouches}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future || w.team.pplDealsCount === 0) return <EmptyCell future={future} />;
                return (
                  <MetricCell
                    value={w.team.pplTouchesAvg.toFixed(1)}
                    sub={`(${w.team.pplDealsCount} deal${w.team.pplDealsCount !== 1 ? 's' : ''})`}
                    colorClass={countColor(w.team.pplTouchesAvg, goals.pplAvgTouches)}
                  />
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future || !ae || ae.pplDealsCount === 0) return <EmptyCell future={future} />;
                return (
                  <MetricCell
                    value={ae.pplTouchesAvg.toFixed(1)}
                    sub={`(${ae.pplDealsCount} deal${ae.pplDealsCount !== 1 ? 's' : ''})`}
                    colorClass={countColor(ae.pplTouchesAvg, goals.pplAvgTouches)}
                  />
                );
              }}
              renderTotalCell={() => {
                if (teamTotals.pplDealsCount === 0) return <EmptyCell />;
                const avg = teamTotals.pplTouchesTotal / teamTotals.pplDealsCount;
                return (
                  <MetricCell
                    value={avg.toFixed(1)}
                    sub={`(${teamTotals.pplDealsCount} deal${teamTotals.pplDealsCount !== 1 ? 's' : ''})`}
                    colorClass={countColor(avg, goals.pplAvgTouches)}
                  />
                );
              }}
              renderAETotalCell={(aeId) => {
                const totals = weeks.reduce(
                  (acc, w) => {
                    const ae = w.byAE.find((a) => a.ownerId === aeId);
                    return {
                      touches: acc.touches + (ae?.pplTouchesTotal || 0),
                      deals: acc.deals + (ae?.pplDealsCount || 0),
                    };
                  },
                  { touches: 0, deals: 0 }
                );
                if (totals.deals === 0) return <EmptyCell />;
                const avg = totals.touches / totals.deals;
                return (
                  <MetricCell
                    value={avg.toFixed(1)}
                    sub={`(${totals.deals} deal${totals.deals !== 1 ? 's' : ''})`}
                    colorClass={countColor(avg, goals.pplAvgTouches)}
                  />
                );
              }}
            />

            {/* ─── Metric 5: PPL First Week Daily Touch Compliance ─── */}
            <MetricSection
              title="PPL First Week Daily Touch Compliance"
              goal={`Goal: ${formatPct(goals.pplDailyCompliance)}`}
              tooltip={METRIC_TOOLTIPS.pplCompliance}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future || (w.team.pplComplianceDealsCount || 0) === 0) return <EmptyCell future={future} />;
                return (
                  <button
                    className="w-full text-left cursor-pointer"
                    onClick={() => setPplModal({ weekNumber: w.weekNumber })}
                  >
                    <MetricCell
                      value={formatPct(w.team.pplComplianceAvg)}
                      sub={`(${w.team.pplComplianceDealsCount} deal${w.team.pplComplianceDealsCount !== 1 ? 's' : ''})`}
                      colorClass={pctColor(w.team.pplComplianceAvg, goals.pplDailyCompliance)}
                    />
                  </button>
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future || !ae || (ae.pplComplianceDealsCount || 0) === 0) return <EmptyCell future={future} />;
                const aeName = aeMap.get(aeId) || 'Unknown';
                return (
                  <button
                    className="w-full text-left cursor-pointer"
                    onClick={() => setPplModal({ weekNumber: w.weekNumber, ownerId: aeId, ownerName: aeName })}
                  >
                    <MetricCell
                      value={formatPct(ae.pplComplianceAvg)}
                      sub={`(${ae.pplComplianceDealsCount} deal${ae.pplComplianceDealsCount !== 1 ? 's' : ''})`}
                      colorClass={pctColor(ae.pplComplianceAvg, goals.pplDailyCompliance)}
                    />
                  </button>
                );
              }}
              renderTotalCell={() => {
                if (teamTotals.pplComplianceDealsCount === 0) return <EmptyCell />;
                const avg = teamTotals.pplComplianceSum / teamTotals.pplComplianceDealsCount;
                return (
                  <MetricCell
                    value={formatPct(avg)}
                    sub={`(${teamTotals.pplComplianceDealsCount} deal${teamTotals.pplComplianceDealsCount !== 1 ? 's' : ''})`}
                    colorClass={pctColor(avg, goals.pplDailyCompliance)}
                  />
                );
              }}
              renderAETotalCell={(aeId) => {
                const totals = weeks.reduce(
                  (acc, w) => {
                    const ae = w.byAE.find((a) => a.ownerId === aeId);
                    return {
                      complianceSum: acc.complianceSum + (ae?.pplComplianceSum || 0),
                      deals: acc.deals + (ae?.pplComplianceDealsCount || 0),
                    };
                  },
                  { complianceSum: 0, deals: 0 }
                );
                if (totals.deals === 0) return <EmptyCell />;
                const avg = totals.complianceSum / totals.deals;
                return (
                  <MetricCell
                    value={formatPct(avg)}
                    sub={`(${totals.deals} deal${totals.deals !== 1 ? 's' : ''})`}
                    colorClass={pctColor(avg, goals.pplDailyCompliance)}
                  />
                );
              }}
            />

            {/* ─── Metric 6: PPL Daily Call Compliance (2 calls/day) ─── */}
            <MetricSection
              title="PPL Daily Call Compliance (2 calls/day)"
              goal={`Goal: ${formatPct(goals.pplCallCompliance)}`}
              tooltip={METRIC_TOOLTIPS.pplCallCompliance}
              weeks={weeks}
              aeList={aeList}
              renderTeamCell={(w) => {
                const future = isFutureWeek(w.weekStart);
                if (future || (w.team.pplCallComplianceDealsCount || 0) === 0) return <EmptyCell future={future} />;
                return (
                  <button
                    className="w-full text-left cursor-pointer"
                    onClick={() => setPplModal({ weekNumber: w.weekNumber })}
                  >
                    <MetricCell
                      value={formatPct(w.team.pplCallComplianceAvg)}
                      sub={`(${w.team.pplCallComplianceDealsCount} deal${w.team.pplCallComplianceDealsCount !== 1 ? 's' : ''})`}
                      colorClass={pctColor(w.team.pplCallComplianceAvg, goals.pplCallCompliance)}
                    />
                  </button>
                );
              }}
              renderAECell={(w, aeId) => {
                const future = isFutureWeek(w.weekStart);
                const ae = w.byAE.find((a) => a.ownerId === aeId);
                if (future || !ae || (ae.pplCallComplianceDealsCount || 0) === 0) return <EmptyCell future={future} />;
                const aeName = aeMap.get(aeId) || 'Unknown';
                return (
                  <button
                    className="w-full text-left cursor-pointer"
                    onClick={() => setPplModal({ weekNumber: w.weekNumber, ownerId: aeId, ownerName: aeName })}
                  >
                    <MetricCell
                      value={formatPct(ae.pplCallComplianceAvg)}
                      sub={`(${ae.pplCallComplianceDealsCount} deal${ae.pplCallComplianceDealsCount !== 1 ? 's' : ''})`}
                      colorClass={pctColor(ae.pplCallComplianceAvg, goals.pplCallCompliance)}
                    />
                  </button>
                );
              }}
              renderTotalCell={() => {
                if (teamTotals.pplCallComplianceDealsCount === 0) return <EmptyCell />;
                const avg = teamTotals.pplCallComplianceSum / teamTotals.pplCallComplianceDealsCount;
                return (
                  <MetricCell
                    value={formatPct(avg)}
                    sub={`(${teamTotals.pplCallComplianceDealsCount} deal${teamTotals.pplCallComplianceDealsCount !== 1 ? 's' : ''})`}
                    colorClass={pctColor(avg, goals.pplCallCompliance)}
                  />
                );
              }}
              renderAETotalCell={(aeId) => {
                const totals = weeks.reduce(
                  (acc, w) => {
                    const ae = w.byAE.find((a) => a.ownerId === aeId);
                    return {
                      complianceSum: acc.complianceSum + (ae?.pplCallComplianceSum || 0),
                      deals: acc.deals + (ae?.pplCallComplianceDealsCount || 0),
                    };
                  },
                  { complianceSum: 0, deals: 0 }
                );
                if (totals.deals === 0) return <EmptyCell />;
                const avg = totals.complianceSum / totals.deals;
                return (
                  <MetricCell
                    value={formatPct(avg)}
                    sub={`(${totals.deals} deal${totals.deals !== 1 ? 's' : ''})`}
                    colorClass={pctColor(avg, goals.pplCallCompliance)}
                  />
                );
              }}
            />

            {/* ─── Stage Progression Indicators ─── */}
            {stageCountsData && (
              <>
                {/* Visual separator */}
                <tr>
                  <td
                    colSpan={weeks.length + 2}
                    className="bg-indigo-900 text-white px-4 py-2.5 font-bold text-sm border-t-4 border-indigo-400"
                  >
                    Stage Progression Indicators
                    <span className="ml-3 font-normal text-indigo-200 text-xs">Leading measures — deals entering each stage per week</span>
                  </td>
                </tr>

                {(Object.keys(STAGE_LABELS) as StageKey[]).map((stageKey) => {
                  const goal = stageCountsData.goals[stageKey];
                  return (
                    <StageMetricSection
                      key={stageKey}
                      stageKey={stageKey}
                      title={STAGE_LABELS[stageKey]}
                      goal={goal}
                      tooltip={METRIC_TOOLTIPS[stageKey]}
                      weeks={weeks}
                      stageWeeks={stageCountsData.weeks}
                      aeList={aeList}
                      onCellClick={(weekNumber, ownerId, ownerName) =>
                        setStageDrillModal({ weekNumber, stage: stageKey, stageLabel: STAGE_LABELS[stageKey], ownerId, ownerName })
                      }
                    />
                  );
                })}

                {/* ─── Leading Measures ─── */}
                <tr>
                  <td
                    colSpan={weeks.length + 2}
                    className="bg-indigo-900 text-white px-4 py-2.5 font-bold text-sm border-t-4 border-indigo-400"
                  >
                    Leading Measures
                    <span className="ml-3 font-normal text-indigo-200 text-xs">Pipeline velocity and conversion metrics</span>
                  </td>
                </tr>

                {/* ─── Speed to Demo (MQL → Demo Scheduled) ─── */}
                <LeadingMeasureSection
                  title="Speed to Demo (MQL → Demo)"
                  goalLabel={`Goal: ≤${stageCountsData.goals.speedToDemo}d`}
                  tooltip={METRIC_TOOLTIPS.speedToDemo}
                  weeks={weeks}
                  stageWeeks={stageCountsData.weeks}
                  aeList={aeList}
                  renderTeamValue={(sw) => {
                    if (sw.speedToDemo.dealCount === 0) return null;
                    return { value: `${sw.speedToDemo.avgDays.toFixed(1)}d`, sub: `(${sw.speedToDemo.dealCount} deal${sw.speedToDemo.dealCount !== 1 ? 's' : ''})`, colorClass: daysColor(sw.speedToDemo.avgDays, stageCountsData.goals.speedToDemo) };
                  }}
                  renderAEValue={(ae) => {
                    if (ae.speedToDemo.dealCount === 0) return null;
                    return { value: `${ae.speedToDemo.avgDays.toFixed(1)}d`, sub: `(${ae.speedToDemo.dealCount})`, colorClass: daysColor(ae.speedToDemo.avgDays, stageCountsData.goals.speedToDemo) };
                  }}
                  computeTotal={(stageWeeks) => {
                    let totalDays = 0, totalDeals = 0;
                    for (const sw of stageWeeks) { totalDays += sw.speedToDemo.avgDays * sw.speedToDemo.dealCount; totalDeals += sw.speedToDemo.dealCount; }
                    if (totalDeals === 0) return null;
                    const avg = totalDays / totalDeals;
                    return { value: `${avg.toFixed(1)}d`, sub: `(${totalDeals})`, colorClass: daysColor(avg, stageCountsData.goals.speedToDemo) };
                  }}
                  computeAETotal={(stageWeeks, aeId) => {
                    let totalDays = 0, totalDeals = 0;
                    for (const sw of stageWeeks) { const ae = sw.byAE.find(a => a.ownerId === aeId); if (ae) { totalDays += ae.speedToDemo.avgDays * ae.speedToDemo.dealCount; totalDeals += ae.speedToDemo.dealCount; } }
                    if (totalDeals === 0) return null;
                    const avg = totalDays / totalDeals;
                    return { value: `${avg.toFixed(1)}d`, sub: `(${totalDeals})`, colorClass: daysColor(avg, stageCountsData.goals.speedToDemo) };
                  }}
                  onCellClick={(weekNumber, ownerId, ownerName) =>
                    setLeadingMetricModal({ weekNumber, metricType: 'speedToDemo', ownerId, ownerName })
                  }
                />

                {/* ─── Demo → Proposal Conversion ─── */}
                <LeadingMeasureSection
                  title="Demo → Proposal Conversion (14d)"
                  goalLabel={`Goal: ${Math.round(stageCountsData.goals.demoToProposal * 100)}%`}
                  tooltip={METRIC_TOOLTIPS.demoToProposal}
                  weeks={weeks}
                  stageWeeks={stageCountsData.weeks}
                  aeList={aeList}
                  renderTeamValue={(sw) => {
                    if (sw.demoToProposal.total === 0) return null;
                    const colorClass = sw.demoToProposal.inProgress ? 'bg-blue-100 text-blue-800' : pctColor(sw.demoToProposal.pct, stageCountsData.goals.demoToProposal);
                    return { value: formatPct(sw.demoToProposal.pct), sub: `(${sw.demoToProposal.converted}/${sw.demoToProposal.total})`, colorClass };
                  }}
                  renderAEValue={(ae) => {
                    if (ae.demoToProposal.total === 0) return null;
                    const colorClass = ae.demoToProposal.inProgress ? 'bg-blue-100 text-blue-800' : pctColor(ae.demoToProposal.pct, stageCountsData.goals.demoToProposal);
                    return { value: formatPct(ae.demoToProposal.pct), sub: `(${ae.demoToProposal.converted}/${ae.demoToProposal.total})`, colorClass };
                  }}
                  computeTotal={(stageWeeks) => {
                    let converted = 0, total = 0;
                    for (const sw of stageWeeks) { converted += sw.demoToProposal.converted; total += sw.demoToProposal.total; }
                    if (total === 0) return null;
                    const pct = converted / total;
                    return { value: formatPct(pct), sub: `(${converted}/${total})`, colorClass: pctColor(pct, stageCountsData.goals.demoToProposal) };
                  }}
                  computeAETotal={(stageWeeks, aeId) => {
                    let converted = 0, total = 0;
                    for (const sw of stageWeeks) { const ae = sw.byAE.find(a => a.ownerId === aeId); if (ae) { converted += ae.demoToProposal.converted; total += ae.demoToProposal.total; } }
                    if (total === 0) return null;
                    const pct = converted / total;
                    return { value: formatPct(pct), sub: `(${converted}/${total})`, colorClass: pctColor(pct, stageCountsData.goals.demoToProposal) };
                  }}
                  onCellClick={(weekNumber, ownerId, ownerName) =>
                    setLeadingMetricModal({ weekNumber, metricType: 'demoConversion', ownerId, ownerName })
                  }
                />
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* PPL Drill-Down Modal */}
      <PplDrillDownModal
        isOpen={pplModal !== null}
        onClose={() => setPplModal(null)}
        year={selectedYear}
        quarter={selectedQuarter}
        weekNumber={pplModal?.weekNumber ?? 1}
        ownerId={pplModal?.ownerId}
        ownerName={pplModal?.ownerName}
      />

      {/* Stage Deals Drill-Down Modal */}
      <StageDealsDrillDownModal
        isOpen={stageDrillModal !== null}
        onClose={() => setStageDrillModal(null)}
        year={selectedYear}
        quarter={selectedQuarter}
        weekNumber={stageDrillModal?.weekNumber ?? 1}
        stage={stageDrillModal?.stage ?? 'mql'}
        stageLabel={stageDrillModal?.stageLabel ?? 'MQL'}
        ownerId={stageDrillModal?.ownerId}
        ownerName={stageDrillModal?.ownerName}
      />

      {/* Leading Metric Drill-Down Modal */}
      <LeadingMetricDrillDownModal
        isOpen={leadingMetricModal !== null}
        onClose={() => setLeadingMetricModal(null)}
        year={selectedYear}
        quarter={selectedQuarter}
        weekNumber={leadingMetricModal?.weekNumber ?? 1}
        metricType={leadingMetricModal?.metricType ?? 'speedToDemo'}
        ownerId={leadingMetricModal?.ownerId}
        ownerName={leadingMetricModal?.ownerName}
      />
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
        <h2 className="text-2xl font-bold text-slate-800">Hot Tracker</h2>
        <p className="text-sm text-slate-500 mt-0.5">Weekly leading indicators for SQL response time, call activity, and giftology</p>
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

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block ml-2 align-middle">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/20 hover:bg-white/40 text-white text-[10px] font-bold leading-none transition-colors"
        aria-label="Info"
      >
        ?
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 p-4 bg-slate-900 text-slate-200 text-sm font-normal leading-relaxed rounded-lg shadow-xl border border-slate-700">
            {text}
          </div>
        </>
      )}
    </span>
  );
}

function MetricSection({
  title,
  goal,
  tooltip,
  weeks,
  aeList,
  renderTeamCell,
  renderAECell,
  renderTotalCell,
  renderAETotalCell,
}: {
  title: string;
  goal: string;
  tooltip?: string;
  weeks: WeekData[];
  aeList: [string, string][];
  renderTeamCell: (w: WeekData) => React.ReactNode;
  renderAECell: (w: WeekData, aeId: string) => React.ReactNode;
  renderTotalCell: () => React.ReactNode;
  renderAETotalCell: (aeId: string) => React.ReactNode;
}) {
  return (
    <>
      {/* Section header row */}
      <tr className="border-t-2 border-slate-300">
        <td
          colSpan={weeks.length + 2}
          className="sticky left-0 z-10 bg-slate-800 text-white px-4 py-2 font-semibold text-sm"
        >
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
          <span className="ml-3 font-normal text-slate-300 text-xs">{goal}</span>
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

function MetricCell({
  value,
  sub,
  colorClass,
}: {
  value: string;
  sub?: string;
  colorClass: string;
}) {
  return (
    <div className={`rounded px-2 py-1 text-xs font-medium ${colorClass}`}>
      <div>{value}</div>
      {sub && <div className="text-[10px] font-normal opacity-75">{sub}</div>}
    </div>
  );
}

function EmptyCell({ future }: { future?: boolean }) {
  return (
    <div className={`px-2 py-1 text-xs ${future ? 'text-slate-300' : 'text-slate-400'}`}>
      {future ? '-' : '-'}
    </div>
  );
}

interface CellValue { value: string; sub: string; colorClass: string }

function LeadingMeasureSection({
  title,
  goalLabel,
  tooltip,
  weeks,
  stageWeeks,
  aeList,
  renderTeamValue,
  renderAEValue,
  computeTotal,
  computeAETotal,
  onCellClick,
}: {
  title: string;
  goalLabel: string;
  tooltip?: string;
  weeks: WeekData[];
  stageWeeks: StageCountsWeek[];
  aeList: [string, string][];
  renderTeamValue: (sw: StageCountsWeek) => CellValue | null;
  renderAEValue: (ae: StageCountsAE) => CellValue | null;
  computeTotal: (stageWeeks: StageCountsWeek[]) => CellValue | null;
  computeAETotal: (stageWeeks: StageCountsWeek[], aeId: string) => CellValue | null;
  onCellClick: (weekNumber: number, ownerId?: string, ownerName?: string) => void;
}) {
  const stageWeekMap = new Map(stageWeeks.map((sw) => [sw.weekNumber, sw]));

  return (
    <>
      <tr className="border-t-2 border-slate-300">
        <td colSpan={weeks.length + 2} className="sticky left-0 z-10 bg-slate-800 text-white px-4 py-2 font-semibold text-sm">
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
          <span className="ml-3 font-normal text-slate-300 text-xs">{goalLabel}</span>
        </td>
      </tr>

      {/* Team total row */}
      <tr className="bg-slate-50 border-b border-slate-200">
        <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 font-semibold text-slate-700 border-r border-slate-200">Team Total</td>
        {weeks.map((w) => {
          const future = isFutureWeek(w.weekStart);
          const sw = stageWeekMap.get(w.weekNumber);
          if (future || !sw) return <td key={w.weekNumber} className="px-1 py-1.5 text-center"><EmptyCell future={future} /></td>;
          const cv = renderTeamValue(sw);
          if (!cv) return <td key={w.weekNumber} className="px-1 py-1.5 text-center"><EmptyCell /></td>;
          return (
            <td key={w.weekNumber} className="px-1 py-1.5 text-center">
              <button className="w-full text-left cursor-pointer" onClick={() => onCellClick(w.weekNumber)}>
                <MetricCell value={cv.value} sub={cv.sub} colorClass={cv.colorClass} />
              </button>
            </td>
          );
        })}
        <td className="px-1 py-1.5 text-center border-l border-slate-300 bg-slate-100">
          {(() => { const cv = computeTotal(stageWeeks); return cv ? <MetricCell value={cv.value} sub={cv.sub} colorClass={cv.colorClass} /> : <EmptyCell />; })()}
        </td>
      </tr>

      {/* Per-AE rows */}
      {aeList.map(([aeId, aeName]) => (
        <tr key={aeId} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="sticky left-0 z-10 bg-white px-4 py-1.5 text-slate-600 text-sm border-r border-slate-200">{aeName}</td>
          {weeks.map((w) => {
            const future = isFutureWeek(w.weekStart);
            const sw = stageWeekMap.get(w.weekNumber);
            if (future || !sw) return <td key={w.weekNumber} className="px-1 py-1 text-center"><EmptyCell future={future} /></td>;
            const ae = sw.byAE.find((a) => a.ownerId === aeId);
            if (!ae) return <td key={w.weekNumber} className="px-1 py-1 text-center"><EmptyCell /></td>;
            const cv = renderAEValue(ae);
            if (!cv) return <td key={w.weekNumber} className="px-1 py-1 text-center"><EmptyCell /></td>;
            return (
              <td key={w.weekNumber} className="px-1 py-1 text-center">
                <button className="w-full text-left cursor-pointer" onClick={() => onCellClick(w.weekNumber, aeId, aeName)}>
                  <MetricCell value={cv.value} sub={cv.sub} colorClass={cv.colorClass} />
                </button>
              </td>
            );
          })}
          <td className="px-1 py-1 text-center border-l border-slate-300 bg-slate-50">
            {(() => { const cv = computeAETotal(stageWeeks, aeId); return cv ? <MetricCell value={cv.value} sub={cv.sub} colorClass={cv.colorClass} /> : <EmptyCell />; })()}
          </td>
        </tr>
      ))}
    </>
  );
}

function StageMetricSection({
  stageKey,
  title,
  goal,
  tooltip,
  weeks,
  stageWeeks,
  aeList,
  onCellClick,
}: {
  stageKey: StageKey;
  title: string;
  goal: number;
  tooltip?: string;
  weeks: WeekData[];
  stageWeeks: StageCountsWeek[];
  aeList: [string, string][];
  onCellClick: (weekNumber: number, ownerId?: string, ownerName?: string) => void;
}) {
  // Build a quick lookup from weekNumber → stage week data
  const stageWeekMap = new Map(stageWeeks.map((sw) => [sw.weekNumber, sw]));

  // Compute AE totals across all weeks
  const aeTotals = new Map<string, number>();
  let teamTotal = 0;
  for (const sw of stageWeeks) {
    teamTotal += sw.team[stageKey];
    for (const ae of sw.byAE) {
      aeTotals.set(ae.ownerId, (aeTotals.get(ae.ownerId) || 0) + ae[stageKey]);
    }
  }

  return (
    <>
      {/* Section header row */}
      <tr className="border-t-2 border-slate-300">
        <td
          colSpan={weeks.length + 2}
          className="sticky left-0 z-10 bg-slate-800 text-white px-4 py-2 font-semibold text-sm"
        >
          {title}
          {tooltip && <InfoTooltip text={tooltip} />}
          <span className="ml-3 font-normal text-slate-300 text-xs">Goal: {goal}/AE/wk</span>
        </td>
      </tr>

      {/* Team total row */}
      <tr className="bg-slate-50 border-b border-slate-200">
        <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 font-semibold text-slate-700 border-r border-slate-200">
          Team Total
        </td>
        {weeks.map((w) => {
          const future = isFutureWeek(w.weekStart);
          const sw = stageWeekMap.get(w.weekNumber);
          const count = sw?.team[stageKey] || 0;
          if (future) return <td key={w.weekNumber} className="px-1 py-1.5 text-center"><EmptyCell future /></td>;
          const teamGoal = goal * aeList.length;
          return (
            <td key={w.weekNumber} className="px-1 py-1.5 text-center">
              <button
                className="w-full text-left cursor-pointer"
                onClick={() => onCellClick(w.weekNumber)}
              >
                <MetricCell
                  value={String(count)}
                  colorClass={countColor(count, teamGoal)}
                />
              </button>
            </td>
          );
        })}
        <td className="px-1 py-1.5 text-center border-l border-slate-300 bg-slate-100">
          <MetricCell
            value={String(teamTotal)}
            colorClass={countColor(
              teamTotal,
              goal * aeList.length * weeks.filter((w) => !isFutureWeek(w.weekStart)).length
            )}
          />
        </td>
      </tr>

      {/* Per-AE rows */}
      {aeList.map(([aeId, aeName]) => (
        <tr key={aeId} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="sticky left-0 z-10 bg-white px-4 py-1.5 text-slate-600 text-sm border-r border-slate-200">
            {aeName}
          </td>
          {weeks.map((w) => {
            const future = isFutureWeek(w.weekStart);
            const sw = stageWeekMap.get(w.weekNumber);
            const ae = sw?.byAE.find((a) => a.ownerId === aeId);
            const count = ae?.[stageKey] || 0;
            if (future) return <td key={w.weekNumber} className="px-1 py-1 text-center"><EmptyCell future /></td>;
            return (
              <td key={w.weekNumber} className="px-1 py-1 text-center">
                <button
                  className="w-full text-left cursor-pointer"
                  onClick={() => onCellClick(w.weekNumber, aeId, aeName)}
                >
                  <MetricCell
                    value={String(count)}
                    colorClass={countColor(count, goal)}
                  />
                </button>
              </td>
            );
          })}
          <td className="px-1 py-1 text-center border-l border-slate-300 bg-slate-50">
            <MetricCell
              value={String(aeTotals.get(aeId) || 0)}
              colorClass={countColor(
                aeTotals.get(aeId) || 0,
                goal * weeks.filter((w) => !isFutureWeek(w.weekStart)).length
              )}
            />
          </td>
        </tr>
      ))}
    </>
  );
}
