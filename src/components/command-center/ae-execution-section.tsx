'use client';

import type { AEExecutionSummary } from '@/lib/command-center/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
};

const GRADE_BAR_COLORS: Record<string, string> = {
  A: 'bg-emerald-500',
  B: 'bg-blue-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-red-500',
};

interface AEExecutionSectionProps {
  aeExecutions: AEExecutionSummary[];
  onSelectAE: (ownerId: string | null) => void;
  activeAEFilter: string | null;
}

export function AEExecutionSection({ aeExecutions, onSelectAE, activeAEFilter }: AEExecutionSectionProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">AE Execution Review</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {aeExecutions.map((ae) => (
          <AECard
            key={ae.email}
            ae={ae}
            isActive={activeAEFilter === ae.ownerId}
            onClick={() => onSelectAE(activeAEFilter === ae.ownerId ? null : ae.ownerId)}
          />
        ))}
      </div>
    </div>
  );
}

function AECard({ ae, isActive, onClick }: { ae: AEExecutionSummary; isActive: boolean; onClick: () => void }) {
  const attainmentPct = ae.q2Target > 0
    ? Math.min(100, Math.round((ae.closedWonARR / ae.q2Target) * 100))
    : 0;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-5 shadow-sm cursor-pointer transition-all ${
        isActive
          ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{ae.name}</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${GRADE_COLORS[ae.avgGrade] || 'bg-gray-100'}`}>
          {ae.avgGrade}
        </span>
      </div>

      {/* Quota attainment */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-gray-500">Closed Won</span>
          <span className="text-gray-700 font-mono">{fmt(ae.closedWonARR)} / {fmt(ae.q2Target)}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all"
            style={{ width: `${attainmentPct}%` }}
          />
        </div>
        <div className="text-right text-[11px] text-gray-400 mt-0.5">{attainmentPct}%</div>
      </div>

      {/* Stats row */}
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Pipeline</span>
          <p className="font-mono font-medium text-gray-900">{fmt(ae.pipelineARR)}</p>
        </div>
        <div>
          <span className="text-gray-500">Deals</span>
          <p className="font-mono font-medium text-gray-900">{ae.dealCount}</p>
        </div>
      </div>

      {/* Grade distribution */}
      <div className="mt-3">
        <span className="text-[11px] text-gray-400">Grade Distribution</span>
        <div className="flex items-center gap-1 mt-1">
          {(['A', 'B', 'C', 'D', 'F'] as const).map((g) => {
            const count = ae.gradeDistribution[g];
            if (count === 0) return null;
            return (
              <span key={g} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${GRADE_COLORS[g]}`}>
                {count}{g}
              </span>
            );
          })}
        </div>
      </div>

      {/* Attention flag */}
      {ae.dealsNeedingAttention > 0 && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          {ae.dealsNeedingAttention} deal{ae.dealsNeedingAttention > 1 ? 's' : ''} need attention
        </div>
      )}
    </div>
  );
}
