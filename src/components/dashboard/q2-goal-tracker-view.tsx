'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import {
  computeDealsNeeded, computeDemosNeeded, computeLeadsNeeded,
  computeWeightedPipeline, computeGap, computeWeeklyTimeline,
  computeAEBreakdown, computeSourceRequirements, computeWeeklyTargets,
} from '@/lib/q2-goal-tracker/math';

// ── Helpers ──

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Slider state ──

interface SliderValues {
  avgDealSize: number;
  demoToWonRate: number;
  createToDemoRate: number;
  cycleTime: number;
}

// ── Main Component ──

export function Q2GoalTrackerView() {
  const [data, setData] = useState<Q2GoalTrackerApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sliders, setSliders] = useState<SliderValues | null>(null);
  const [defaults, setDefaults] = useState<SliderValues | null>(null);
  const [selectedRateSetIndex, setSelectedRateSetIndex] = useState(0);

  function ratesToSliders(rates: Q2GoalTrackerApiResponse['historicalRates']): SliderValues {
    return {
      avgDealSize: Math.round(rates.avgDealSize),
      demoToWonRate: rates.demoToWonRate,
      createToDemoRate: rates.createToDemoRate,
      cycleTime: rates.avgCycleTime,
    };
  }

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/q2-goal-tracker');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json: Q2GoalTrackerApiResponse = await res.json();
      setData(json);

      // Default to first rate set (Q1 2026)
      const rates = json.rateSets?.[0]?.rates || json.historicalRates;
      const d = ratesToSliders(rates);
      setDefaults(d);
      setSliders(d);
      setSelectedRateSetIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  function switchRateSet(index: number) {
    if (!data?.rateSets?.[index]) return;
    setSelectedRateSetIndex(index);
    const d = ratesToSliders(data.rateSets[index].rates);
    setDefaults(d);
    setSliders(d);
  }

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Computed state (updates instantly on slider changes) ──

  const computed = useMemo(() => {
    if (!data || !sliders) return null;

    const dealsNeeded = computeDealsNeeded(data.teamTarget, sliders.avgDealSize);
    const demosNeeded = computeDemosNeeded(dealsNeeded, sliders.demoToWonRate);
    const leadsNeeded = computeLeadsNeeded(demosNeeded, sliders.createToDemoRate);
    const weightedPipeline = computeWeightedPipeline(data.pipelineCredit, sliders.demoToWonRate, sliders.createToDemoRate);
    const teamForecastRaw = data.pipelineCredit.teamForecastARR || 0;
    const teamForecastWeighted = Math.round(teamForecastRaw * sliders.demoToWonRate); // Apply close rate
    const gap = computeGap(data.teamTarget, teamForecastWeighted);
    const gapCloses = computeDealsNeeded(gap, sliders.avgDealSize);
    const selectedRates = data.rateSets?.[selectedRateSetIndex]?.rates || data.historicalRates;
    const timeline = computeWeeklyTimeline(
      data.quarter.startDate, data.quarter.endDate,
      sliders.cycleTime, selectedRates.avgDemoToClose
    );
    const aeBreakdown = computeAEBreakdown(data.aeData, sliders.avgDealSize, sliders.demoToWonRate, sliders.createToDemoRate);
    const sourceReqs = computeSourceRequirements(demosNeeded, data.leadSourceRates);
    const weeklyTargets = computeWeeklyTargets(data.teamTarget);

    // Delta from defaults
    const defaultDeals = defaults ? computeDealsNeeded(data.teamTarget, defaults.avgDealSize) : dealsNeeded;
    const defaultDemos = defaults ? computeDemosNeeded(defaultDeals, defaults.demoToWonRate) : demosNeeded;
    const defaultLeads = defaults ? computeLeadsNeeded(defaultDemos, defaults.createToDemoRate) : leadsNeeded;

    // Deadline calculations — both dynamic based on slider cycle time
    // Demo-to-close portion = full cycle minus create-to-demo portion
    // As you compress the full cycle, the demo deadline moves later (more time)
    const q2EndMs = new Date(data.quarter.endDate).getTime();
    const createToDemoDays = selectedRates.avgCreateToDemo || 6;
    const demoToCloseDays = Math.max(7, sliders.cycleTime - createToDemoDays);
    const demoDeadline = new Date(q2EndMs - demoToCloseDays * 86400000);
    const leadDeadline = new Date(q2EndMs - sliders.cycleTime * 86400000);

    // Gap-specific reverse engineering (Row 3)
    const gapDemos = computeDemosNeeded(gapCloses, sliders.demoToWonRate);
    const gapLeads = computeLeadsNeeded(gapDemos, sliders.createToDemoRate);

    return {
      dealsNeeded, demosNeeded, leadsNeeded,
      weightedPipeline, teamForecastRaw, teamForecastWeighted, gap, gapCloses,
      gapDemos, gapLeads,
      timeline, aeBreakdown, sourceReqs, weeklyTargets,
      demoDeadline, demoToCloseDays,
      leadDeadline,
      deltaDeals: dealsNeeded - defaultDeals,
      deltaDemos: demosNeeded - defaultDemos,
      deltaLeads: leadsNeeded - defaultLeads,
    };
  }, [data, sliders, defaults, selectedRateSetIndex]);

  // ── Loading / Error states ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error || !data || !sliders || !computed) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 m-6">
        <p className="text-sm text-red-700">{error || 'Failed to load data'}</p>
        <button onClick={fetchData} className="mt-2 text-sm text-red-600 font-medium">Try again</button>
      </div>
    );
  }

  // ── Presets ──

  function applyPreset(multiplier: number) {
    if (!defaults) return;
    setSliders({
      avgDealSize: Math.round(defaults.avgDealSize * multiplier),
      demoToWonRate: Math.min(1, defaults.demoToWonRate * multiplier),
      createToDemoRate: Math.min(1, defaults.createToDemoRate * multiplier),
      cycleTime: Math.max(20, Math.round(defaults.cycleTime / multiplier)),
    });
  }

  const selectedRates = data?.rateSets?.[selectedRateSetIndex]?.rates || data?.historicalRates;

  // ── Cumulative chart data ──

  const chartData = data.weeklyActuals.map((w, i) => {
    const cumulativeActual = data.weeklyActuals
      .slice(0, i + 1)
      .reduce((s, wk) => s + wk.closedWonARR, 0);
    return {
      week: `Wk${w.weekNumber}`,
      weekLabel: formatWeekLabel(w.weekStart),
      target: computed.weeklyTargets[i]?.cumulativeTarget || 0,
      actual: cumulativeActual,
    };
  });

  return (
    <div className="space-y-6 p-6">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Q2 2026 Goal Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Apr 1 – Jun 30 &middot; Week {data.progress.currentWeek} of 13
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Cohort toggle */}
          {data.rateSets && data.rateSets.length > 1 && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {data.rateSets.map((rs, i) => (
                <button
                  key={rs.label}
                  onClick={() => switchRateSet(i)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    selectedRateSetIndex === i
                      ? 'bg-white text-indigo-700 shadow-sm border border-gray-200'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title={rs.description}
                >
                  {rs.label}
                </button>
              ))}
            </div>
          )}
          <div className="text-right">
            <div className="text-xs text-gray-500">{Math.round(data.progress.percentComplete)}% through quarter</div>
            <div className="mt-1 w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${data.progress.percentComplete}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Cohort info banner ── */}
      {data.rateSets?.[selectedRateSetIndex] && (
        <div className="bg-gray-50 rounded-lg px-4 py-2 border border-gray-200 text-xs text-gray-600 flex items-center justify-between">
          <span>
            Using <strong>{data.rateSets[selectedRateSetIndex].label}</strong> rates: {data.rateSets[selectedRateSetIndex].description}
          </span>
          <span className="text-gray-400">
            Sample: {data.rateSets[selectedRateSetIndex].sampleSize} deals
          </span>
        </div>
      )}

      {/* ── Section 1: Headline Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeadlineCard
          label="Team Target" value={fmt(data.teamTarget)}
          sub={`Expected from Pipeline: ${fmt(computed.teamForecastWeighted)}`}
          sub2={`Gap: ${fmt(computed.gap)}`}
          color="indigo"
          tooltip={`Team-confirmed pipeline ($${Math.round(computed.teamForecastRaw / 1000)}K raw) weighted by ${pct1(sliders.demoToWonRate)} close rate = ${fmt(computed.teamForecastWeighted)} expected revenue.`}
        />
        <HeadlineCard
          label="Deals to Close" value={String(computed.dealsNeeded)}
          sub={`At ${fmtFull(sliders.avgDealSize)} avg deal`}
          sub2={`~${Math.ceil(computed.dealsNeeded / 3)}/month`}
          delta={computed.deltaDeals} deltaLabel="deals"
          color="blue"
          tooltip={`${fmt(data.teamTarget)} target ÷ ${fmtFull(sliders.avgDealSize)} avg deal size = ${computed.dealsNeeded} deals. Avg deal size based on ${selectedRates.closedWonCount} closed-won deals totaling ${fmt(selectedRates.totalWonARR)}.`}
        />
        <HeadlineCard
          label="Demos Needed" value={String(computed.demosNeeded)}
          sub={`${pct1(sliders.demoToWonRate)} demo-to-won rate`}
          sub2={`~${Math.ceil(computed.demosNeeded / 3)}/month`}
          delta={computed.deltaDemos} deltaLabel="demos"
          color="purple"
          tooltip={`Of ${selectedRates.demoCompletedCount} deals that completed a demo, ${selectedRates.closedWonCount} closed won = ${pct1(sliders.demoToWonRate)} close rate. ${computed.dealsNeeded} closes ÷ ${pct1(sliders.demoToWonRate)} = ${computed.demosNeeded} demos needed.`}
        />
        <HeadlineCard
          label="Leads Needed" value={String(computed.leadsNeeded)}
          sub={`${pct1(sliders.createToDemoRate)} create-to-demo rate`}
          sub2={`~${Math.ceil(computed.leadsNeeded / 3)}/month`}
          delta={computed.deltaLeads} deltaLabel="leads"
          color="emerald"
          tooltip={`Of ${selectedRates.dealsCreatedCount} deals created, ${selectedRates.demoCompletedCount} reached demo completed = ${pct1(sliders.createToDemoRate)} rate. ${computed.demosNeeded} demos ÷ ${pct1(sliders.createToDemoRate)} = ${computed.leadsNeeded} leads. Includes ALL lead sources (PPL, organic, PPC, etc.).`}
        />
      </div>

      {/* ── Section 2: Adjust Assumptions (MOVED ABOVE formula) ── */}
      <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-indigo-800 uppercase tracking-wide">Adjust Assumptions</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => applyPreset(1)} className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 transition-colors">
              Conservative
            </button>
            <button onClick={() => applyPreset(1.2)} className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 transition-colors">
              Moderate (+20%)
            </button>
            <button onClick={() => applyPreset(1.3)} className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 transition-colors">
              Aggressive (+30%)
            </button>
            <button onClick={() => defaults && setSliders({ ...defaults })} className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
              Reset
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <SliderControl
            label="Avg Deal Size"
            value={sliders.avgDealSize}
            min={10000} max={60000} step={1000}
            format={(v) => fmtFull(v)}
            onChange={(v) => setSliders({ ...sliders, avgDealSize: v })}
          />
          <SliderControl
            label="Demo → Won Rate"
            value={sliders.demoToWonRate}
            min={0.05} max={0.50} step={0.005}
            format={(v) => pct1(v)}
            onChange={(v) => setSliders({ ...sliders, demoToWonRate: v })}
          />
          <SliderControl
            label="Create → Demo Rate"
            value={sliders.createToDemoRate}
            min={0.10} max={0.90} step={0.01}
            format={(v) => pct1(v)}
            onChange={(v) => setSliders({ ...sliders, createToDemoRate: v })}
          />
          <SliderControl
            label="Avg Cycle Time"
            value={sliders.cycleTime}
            min={20} max={120} step={1}
            format={(v) => `${v} days`}
            onChange={(v) => setSliders({ ...sliders, cycleTime: v })}
          />
        </div>
      </div>

      {/* ── Section 3: Reverse-Engineering Formula (BIGGER) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Reverse-Engineering Formula</h2>
          <span className="text-xs text-gray-400">Row 1: Total requirement | Row 2: Pipeline credit | Row 3: New Q2 activity needed</span>
        </div>
        {/* Row 1: Total requirements */}
        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2 ml-1">Total Requirement</div>
        <div className="flex items-center gap-3 overflow-x-auto pb-3 justify-center">
          <ChainBoxLg label="Target" value={fmt(data.teamTarget)} />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Avg Deal" value={fmtFull(sliders.avgDealSize)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="Closes" value={String(computed.dealsNeeded)} highlight />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Demo→Won" value={pct1(sliders.demoToWonRate)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="Demos" value={String(computed.demosNeeded)} highlight />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Create→Demo" value={pct1(sliders.createToDemoRate)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="Leads" value={String(computed.leadsNeeded)} highlight />
        </div>
        {/* Row 2: Pipeline credit → gap */}
        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2 ml-1 mt-4 pt-4 border-t border-gray-100">Pipeline Credit</div>
        <div className="flex items-center gap-3 overflow-x-auto pb-3 justify-center">
          <ChainBoxLg label="Target" value={fmt(data.teamTarget)} />
          <ChainOpLg op="−" />
          <ChainBoxLg label="Expected Pipeline" value={fmt(computed.teamForecastWeighted)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="Gap" value={fmt(computed.gap)} highlight />
        </div>
        {/* Row 3: Gap reverse-engineering */}
        <div className="text-[10px] font-medium text-amber-600 uppercase tracking-wide mb-2 ml-1 mt-4 pt-4 border-t border-gray-100">New Q2 Activity Needed (The Work)</div>
        <div className="flex items-center gap-3 overflow-x-auto pb-3 justify-center">
          <ChainBoxLg label="Gap" value={fmt(computed.gap)} />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Avg Deal" value={fmtFull(sliders.avgDealSize)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="New Closes" value={String(computed.gapCloses)} highlight />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Demo→Won" value={pct1(sliders.demoToWonRate)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="New Demos" value={String(computed.gapDemos)} highlight />
          <ChainOpLg op="÷" />
          <ChainBoxLg label="Create→Demo" value={pct1(sliders.createToDemoRate)} muted />
          <ChainOpLg op="=" />
          <ChainBoxLg label="New Leads" value={String(computed.gapLeads)} highlight />
        </div>
      </div>

      {/* ── Section 4: Weekly Timeline ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Weekly Timeline — When Must Activity Happen?</h2>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {computed.timeline.map((w) => (
            <div
              key={w.weekNumber}
              className={`flex-1 min-w-[70px] rounded-lg p-2 text-center border-2 transition-all ${
                w.zone === 'green'
                  ? 'bg-green-50 border-green-300'
                  : w.zone === 'yellow'
                    ? 'bg-amber-50 border-amber-300'
                    : 'bg-red-50 border-red-300'
              } ${w.isCurrent ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
            >
              <div className="text-xs font-bold text-gray-800">Wk {w.weekNumber}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{formatWeekLabel(w.weekStart)}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{w.daysRemaining}d left</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-200 border border-green-400" /> Full funnel time</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200 border border-amber-400" /> Demo only (too late for new leads)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200 border border-red-400" /> Too late for median deal</span>
        </div>
        {/* Deadline callout — dynamic based on sliders */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-red-50 rounded-lg px-5 py-4 border border-red-200">
            <div className="text-xs font-semibold text-red-600 uppercase tracking-wide">Demo Completion Deadline</div>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold text-red-800">
                {computed.demosNeeded} demos
              </span>
              <span className="text-lg font-semibold text-red-700">
                by {computed.demoDeadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
              </span>
            </div>
            <div className="text-xs text-red-600 mt-1">
              Based on {computed.demoToCloseDays}-day demo-to-close cycle. Demos completed after this date are unlikely to close in Q2.
            </div>
          </div>
          <div className="bg-amber-50 rounded-lg px-5 py-4 border border-amber-200">
            <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide">New Lead Creation Deadline</div>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-bold text-amber-800">
                {computed.leadsNeeded} leads
              </span>
              <span className="text-lg font-semibold text-amber-700">
                by {computed.leadDeadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
              </span>
            </div>
            <div className="text-xs text-amber-600 mt-1">
              Based on {sliders.cycleTime}-day full cycle. Leads created after this date are unlikely to close in Q2.
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Cumulative Revenue Pacing ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Cumulative Revenue Pacing</h2>
          {chartData.every((d) => d.actual === 0) && (
            <span className="text-xs text-gray-400">Populates as deals close throughout Q2</span>
          )}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={(v: number) => fmt(v)}
                tick={{ fontSize: 12 }}
                width={60}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [fmtFull(Number(value)), String(name) === 'target' ? 'Target Pace' : 'Actual Closed']}
                labelFormatter={(label: unknown) => `Week of ${String(label)}`}
              />
              <Legend />
              <ReferenceLine y={data.teamTarget} stroke="#6366f1" strokeDasharray="8 4" label={{ value: fmt(data.teamTarget), position: 'right', fill: '#6366f1', fontSize: 11 }} />
              <ReferenceLine y={computed.weightedPipeline} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: `Pipeline: ${fmt(computed.weightedPipeline)}`, position: 'right', fill: '#9ca3af', fontSize: 10 }} />
              <Area type="monotone" dataKey="target" stroke="#9ca3af" fill="none" strokeDasharray="6 3" name="Target Pace" />
              <Area type="monotone" dataKey="actual" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} name="Actual Closed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Section 6: Lead Source Breakdown ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Lead Source Conversion Rates</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium text-gray-500">Source</th>
                <th className="text-right py-2 px-4 font-medium text-gray-500">Create→Demo %</th>
                <th className="text-right py-2 px-4 font-medium text-gray-500">Leads per Demo</th>
                <th className="text-right py-2 px-4 font-medium text-gray-500">If 100% This Source</th>
                <th className="text-right py-2 pl-4 font-medium text-gray-500">Historical Count</th>
              </tr>
            </thead>
            <tbody>
              {computed.sourceReqs.map((s) => (
                <tr key={s.source} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium text-gray-900">{s.source}</td>
                  <td className="py-2 px-4 text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      s.createToDemoRate >= 0.5 ? 'bg-green-50 text-green-700' :
                      s.createToDemoRate >= 0.2 ? 'bg-amber-50 text-amber-700' :
                      'bg-red-50 text-red-700'
                    }`}>
                      {pct1(s.createToDemoRate)}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-gray-600">{s.leadsPerDemo.toFixed(1)}</td>
                  <td className="py-2 px-4 text-right font-medium text-gray-900">
                    {s.leadsNeededIfSoleSource > 0 ? s.leadsNeededIfSoleSource.toLocaleString() : 'N/A'}
                  </td>
                  <td className="py-2 pl-4 text-right text-gray-400">
                    {data.leadSourceRates.find((r) => r.source === s.source)?.dealsCreated || 0} deals
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2">
          At the current PPL-heavy mix, the blended create-to-demo rate is {pct1(data.historicalRates.createToDemoRate)}.
          Shifting toward organic/website sources would reduce total leads required.
          &ldquo;If 100% This Source&rdquo; shows {computed.demosNeeded} demos needed &divide; source rate.
        </p>
      </div>

      {/* ── Section 7: Per-AE Breakdown ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Per-AE Requirements</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 pr-4 font-medium text-gray-500">AE</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Q2 Target</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Pipeline</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Closes</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Demos</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Leads</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Closes/Mo</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Best Qtr</th>
                <th className="text-right py-2 pl-3 font-medium text-gray-500">Gap Factor</th>
              </tr>
            </thead>
            <tbody>
              {computed.aeBreakdown.map((ae) => {
                const aeForecast = data.pipelineCredit.teamForecastByAE?.find((f) => f.name === ae.name);
                return (
                <tr key={ae.email} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 pr-4 font-medium text-gray-900">{ae.name}</td>
                  <td className="py-2.5 px-3 text-right">{fmt(ae.q2Target)}</td>
                  <td className="py-2.5 px-3 text-right text-emerald-600 font-medium">
                    {aeForecast ? `${fmt(aeForecast.arr)} (${aeForecast.count})` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold">{ae.closesNeeded}</td>
                  <td className="py-2.5 px-3 text-right">{ae.demosNeeded}</td>
                  <td className="py-2.5 px-3 text-right">{ae.leadsNeeded}</td>
                  <td className="py-2.5 px-3 text-right">{ae.closesPerMonth}</td>
                  <td className="py-2.5 px-3 text-right text-gray-500">
                    {ae.bestQuarterARR > 0 ? `${fmt(ae.bestQuarterARR)} (${ae.bestQuarterLabel})` : 'No data'}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    <GapBadge factor={ae.gapFactor} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 8: Pipeline Credit ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Existing Pipeline Entering Q2</h2>

        {/* Stacked bar — uses weighted team forecast */}
        <div className="mb-4">
          <div className="flex h-8 rounded-lg overflow-hidden border border-gray-200">
            {computed.teamForecastWeighted > 0 && (
              <div
                className="bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white"
                style={{ width: `${Math.min((computed.teamForecastWeighted / data.teamTarget) * 100, 100)}%` }}
                title={`Expected from Pipeline: ${fmtFull(computed.teamForecastWeighted)}`}
              >
                Expected: {fmt(computed.teamForecastWeighted)}
              </div>
            )}
            {computed.gap > 0 && (
              <div
                className="bg-red-100 flex items-center justify-center text-[10px] font-bold text-red-600 border-l border-red-200"
                style={{ width: `${Math.min((computed.gap / data.teamTarget) * 100, 100)}%` }}
              >
                Gap: {fmt(computed.gap)}
              </div>
            )}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>$0</span>
            <span>{fmt(data.teamTarget)} target</span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 text-sm">
          <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
            <div className="text-xs text-emerald-600 font-medium">Team-Confirmed Pipeline</div>
            <div className="text-lg font-bold text-emerald-800">{fmt(computed.teamForecastRaw)}</div>
            <div className="text-xs text-emerald-500">{data.pipelineCredit.teamForecastCount} deals marked &ldquo;likely to close&rdquo;</div>
          </div>
          <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-300">
            <div className="text-xs text-emerald-700 font-medium">Expected Revenue (weighted)</div>
            <div className="text-lg font-bold text-emerald-900">{fmt(computed.teamForecastWeighted)}</div>
            <div className="text-xs text-emerald-600">{fmt(computed.teamForecastRaw)} &times; {pct1(sliders.demoToWonRate)} close rate</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <div className="text-xs text-green-600 font-medium">All Post-Demo Pipeline (raw)</div>
            <div className="text-lg font-bold text-green-800">{fmt(data.pipelineCredit.postDemoRawARR)}</div>
            <div className="text-xs text-green-500">{data.pipelineCredit.postDemoCount} deals total</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="text-xs text-blue-600 font-medium">Pre-Demo Pipeline (raw)</div>
            <div className="text-lg font-bold text-blue-800">{fmt(data.pipelineCredit.preDemoRawARR)}</div>
            <div className="text-xs text-blue-500">{data.pipelineCredit.preDemoCount} deals</div>
          </div>
        </div>

        {/* Team forecast by AE */}
        {data.pipelineCredit.teamForecastByAE && data.pipelineCredit.teamForecastByAE.length > 0 && (
          <div className="mb-4 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
            <h3 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">Team Forecast by AE</h3>
            <div className="flex gap-4">
              {data.pipelineCredit.teamForecastByAE.map((ae) => (
                <div key={ae.name} className="text-sm">
                  <span className="font-medium text-emerald-800">{ae.name}:</span>{' '}
                  <span className="text-emerald-600">{fmt(ae.arr)} ({ae.count} deals)</span>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-emerald-500 mt-1">Based on team pipeline triage — all AEs confirmed</div>
          </div>
        )}

      </div>

      {/* ── Footer ── */}
      <p className="text-xs text-gray-400 text-center pb-4">
        Historical rates based on Q1-Q4 2025 deal cohorts. Data from Supabase (synced from HubSpot).
        Weighted pipeline applies {pct1(sliders.demoToWonRate)} demo-to-won rate to post-demo and
        {' '}{pct1(sliders.createToDemoRate)} create-to-demo rate to pre-demo deals.
      </p>
    </div>
  );
}

// ── Sub-components ──

function HeadlineCard({ label, value, sub, sub2, delta, deltaLabel, color, tooltip }: {
  label: string;
  value: string;
  sub: string;
  sub2?: string;
  delta?: number;
  deltaLabel?: string;
  color: 'indigo' | 'blue' | 'purple' | 'emerald';
  tooltip?: string;
}) {
  const colors = {
    indigo: 'border-indigo-200 bg-indigo-50/30',
    blue: 'border-blue-200 bg-blue-50/30',
    purple: 'border-purple-200 bg-purple-50/30',
    emerald: 'border-emerald-200 bg-emerald-50/30',
  };

  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
        {tooltip && <InfoTip text={tooltip} />}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${delta > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {delta > 0 ? '+' : ''}{delta} {deltaLabel}
          </span>
        )}
      </div>
      <div className="text-sm text-gray-500 mt-1">{sub}</div>
      {sub2 && <div className="text-sm text-gray-400">{sub2}</div>}
    </div>
  );
}

function ChainBox({ label, value, highlight, muted }: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex-shrink-0 rounded-lg px-4 py-2.5 text-center border ${
      highlight
        ? 'bg-indigo-50 border-indigo-300'
        : muted
          ? 'bg-gray-50 border-gray-200'
          : 'bg-white border-gray-200'
    }`}>
      <div className="text-[10px] font-medium text-gray-500 uppercase">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-indigo-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function ChainOp({ op }: { op: string }) {
  return (
    <div className="flex-shrink-0 text-lg font-bold text-gray-400 px-1">{op}</div>
  );
}

function ChainBoxLg({ label, value, highlight, muted }: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex-shrink-0 rounded-xl px-6 py-4 text-center border-2 ${
      highlight
        ? 'bg-indigo-50 border-indigo-400'
        : muted
          ? 'bg-gray-50 border-gray-200'
          : 'bg-white border-gray-200'
    }`}>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-indigo-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function ChainOpLg({ op }: { op: string }) {
  return (
    <div className="flex-shrink-0 text-2xl font-bold text-gray-400 px-1">{op}</div>
  );
}

function SliderControl({ label, value, min, max, step, format, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-indigo-800">{label}</label>
        <span className="text-sm font-bold text-indigo-900">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
      />
      <div className="flex justify-between text-[10px] text-indigo-400 mt-0.5">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold hover:bg-gray-300 cursor-help"
      >
        i
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg leading-relaxed">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </span>
  );
}

function GapBadge({ factor }: { factor: number }) {
  if (factor === 0) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">N/A</span>;
  }
  if (factor <= 1.5) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">{factor.toFixed(1)}x</span>;
  }
  if (factor <= 3) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">{factor.toFixed(1)}x</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200">{factor.toFixed(1)}x</span>;
}
