'use client';

import type { InitiativeStatus } from '@/lib/command-center/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

interface InitiativeTrackerProps {
  initiatives: InitiativeStatus[];
}

export function InitiativeTracker({ initiatives }: InitiativeTrackerProps) {
  if (initiatives.length === 0 || initiatives.every((i) => i.leadsCreated === 0)) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Initiative Tracking</h2>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center text-sm text-slate-500">
          No initiative activity recorded yet. Verify lead source values match HubSpot.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Initiative Tracking</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {initiatives.map((init) => (
          <InitiativeCard key={init.id} initiative={init} />
        ))}
      </div>
    </div>
  );
}

function InitiativeCard({ initiative: init }: { initiative: InitiativeStatus }) {
  const leadPct = init.q2LeadTarget > 0
    ? Math.min(100, Math.round((init.leadsCreated / init.q2LeadTarget) * 100))
    : 0;

  const statusStyles = {
    ahead: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    on_pace: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    behind: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const statusLabels = { ahead: 'Ahead', on_pace: 'On Pace', behind: 'Behind' };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{init.name}</h3>
          {init.ownerLabel && (
            <p className="text-xs text-slate-400">{init.ownerLabel}</p>
          )}
        </div>
        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyles[init.paceStatus]}`}>
          {statusLabels[init.paceStatus]}
        </span>
      </div>

      {/* Lead progress */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-slate-400">Leads</span>
          <span className="text-slate-300">
            {init.leadsCreated} / {init.q2LeadTarget}
          </span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-700">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all"
            style={{ width: `${leadPct}%` }}
          />
        </div>
      </div>

      {/* ARR metrics */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-slate-400">ARR Generated</span>
          <p className="font-mono font-medium text-slate-200">{fmt(init.arrGenerated)}</p>
        </div>
        <div>
          <span className="text-slate-400">ARR Target</span>
          <p className="font-mono font-medium text-slate-200">{fmt(init.q2ArrTarget)}</p>
        </div>
      </div>

      {/* Weekly sparkline */}
      <div className="mt-3">
        <span className="text-xs text-slate-500">Weekly trend</span>
        <Sparkline data={init.weeklyBreakdown} />
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const barWidth = 100 / data.length;

  return (
    <div className="mt-1 flex items-end gap-px" style={{ height: '24px' }}>
      {data.map((val, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-indigo-500/40"
          style={{ height: `${Math.max(2, (val / max) * 100)}%` }}
          title={`W${i + 1}: ${val}`}
        />
      ))}
    </div>
  );
}
