'use client';

import { RingProgress } from './ring-progress';

interface SpiffData {
  calls: {
    today: number;
    dailyGoal: number;
    tier: string;
  };
  demos: {
    thisWeek: number;
    weeklyGoal: number;
    tier: string;
  };
  prospects: {
    thisMonth: number;
    monthlyGoal: number;
    tier: string;
  };
}

function TierBadge({ tier, color }: { tier: string; color: string }) {
  const isBelowBaseline = tier === 'Below';

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isBelowBaseline
          ? 'bg-slate-100 text-slate-600'
          : `text-white`
      }`}
      style={!isBelowBaseline ? { backgroundColor: color } : undefined}
    >
      {tier}
    </span>
  );
}

interface RingCardProps {
  label: string;
  value: number;
  goal: number;
  goalLabel: string;
  tier: string;
  color: string;
}

function RingCard({ label, value, goal, goalLabel, tier, color }: RingCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col items-center gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <RingProgress value={value} goal={goal} color={color} />
      <p className="text-sm text-slate-500">
        of {goal} {goalLabel}
      </p>
      <TierBadge tier={tier} color={color} />
    </div>
  );
}

export function SpiffRings({ calls, demos, prospects }: SpiffData) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <RingCard
        label="Today"
        value={calls.today}
        goal={calls.dailyGoal}
        goalLabel="calls"
        tier={calls.tier}
        color="#3b82f6"
      />
      <RingCard
        label="This Week"
        value={demos.thisWeek}
        goal={demos.weeklyGoal}
        goalLabel="demos"
        tier={demos.tier}
        color="#22c55e"
      />
      <RingCard
        label="This Month"
        value={prospects.thisMonth}
        goal={prospects.monthlyGoal}
        goalLabel="prospects"
        tier={prospects.tier}
        color="#f97316"
      />
    </div>
  );
}
