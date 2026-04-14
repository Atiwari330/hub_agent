'use client';

import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';

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
  const { teamTarget, weeklyActuals, progress } = goalTracker;

  const closedWonARR = weeklyActuals.reduce((sum, w) => sum + w.closedWonARR, 0);
  const closedWonCount = weeklyActuals.reduce((s, w) => s + w.closedWonCount, 0);
  const gap = Math.max(0, teamTarget - closedWonARR);

  const metrics = [
    { label: 'Q2 ARR Target', value: fmt(teamTarget), sub: fmtFull(teamTarget) },
    { label: 'Closed Won', value: fmt(closedWonARR), sub: `${closedWonCount} deals` },
    { label: 'Gap to Target', value: fmt(gap), sub: gap === 0 ? 'Target covered' : `${fmtFull(gap)} remaining` },
  ];

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500">
        Day {progress.daysElapsed} of {progress.totalDays} &middot; {Math.round(progress.percentComplete)}% through Q2
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{m.value}</p>
            <p className="mt-0.5 text-xs text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
