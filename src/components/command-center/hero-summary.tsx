'use client';

import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import { computeWeightedPipeline, computeGap } from '@/lib/q2-goal-tracker/math';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

interface HeroSummaryProps {
  goalTracker: Q2GoalTrackerApiResponse;
}

export function HeroSummary({ goalTracker }: HeroSummaryProps) {
  const { teamTarget, weeklyActuals, pipelineCredit, historicalRates, progress } = goalTracker;

  const closedWonARR = weeklyActuals.reduce((sum, w) => sum + w.closedWonARR, 0);
  const weightedPipeline = computeWeightedPipeline(
    pipelineCredit,
    historicalRates.demoToWonRate,
    historicalRates.createToDemoRate,
  );
  const gap = computeGap(teamTarget, closedWonARR + weightedPipeline);

  // On track logic
  const requiredPace = teamTarget * (progress.currentWeek / 13);
  const actualProgress = closedWonARR + weightedPipeline;
  const paceRatio = requiredPace > 0 ? actualProgress / requiredPace : 0;

  let statusLabel: string;
  let statusColor: string;
  let statusBg: string;
  if (paceRatio >= 0.9) {
    statusLabel = 'On Track';
    statusColor = 'text-emerald-400';
    statusBg = 'bg-emerald-500/10 border-emerald-500/20';
  } else if (paceRatio >= 0.7) {
    statusLabel = 'Behind';
    statusColor = 'text-amber-400';
    statusBg = 'bg-amber-500/10 border-amber-500/20';
  } else {
    statusLabel = 'At Risk';
    statusColor = 'text-red-400';
    statusBg = 'bg-red-500/10 border-red-500/20';
  }

  const metrics = [
    { label: 'Q2 ARR Target', value: fmt(teamTarget), sub: fmtFull(teamTarget) },
    { label: 'Closed Won', value: fmt(closedWonARR), sub: `${weeklyActuals.reduce((s, w) => s + w.closedWonCount, 0)} deals` },
    { label: 'Weighted Pipeline', value: fmt(weightedPipeline), sub: `${pipelineCredit.postDemoCount + pipelineCredit.preDemoCount} deals` },
    { label: 'Gap to Target', value: fmt(gap), sub: gap === 0 ? 'Target covered' : `${fmtFull(gap)} remaining` },
  ];

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div className={`flex items-center justify-between rounded-lg border px-6 py-4 ${statusBg}`}>
        <div className="flex items-center gap-4">
          <span className={`text-2xl font-bold ${statusColor}`}>{statusLabel}</span>
          <span className="text-sm text-slate-400">
            Week {progress.currentWeek} of {progress.totalWeeks} &middot; {Math.round(progress.percentComplete)}% through Q2
          </span>
        </div>
        <div className="text-right text-sm text-slate-400">
          <div>Projected: {fmt(closedWonARR + weightedPipeline)}</div>
          <div>vs Required pace: {fmt(requiredPace)}</div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-white">{m.value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{m.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
