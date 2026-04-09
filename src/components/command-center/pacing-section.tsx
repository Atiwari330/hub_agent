'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { PacingData } from '@/lib/command-center/types';

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface PacingSectionProps {
  pacing: PacingData;
  currentWeek: number;
}

export function PacingSection({ pacing, currentWeek }: PacingSectionProps) {
  // Build cumulative chart data
  const chartData = pacing.weeklyRows.map((row, i) => {
    const cumulativeActual = pacing.weeklyRows
      .slice(0, i + 1)
      .reduce((sum, r) => sum + r.leadsCreated, 0);
    const cumulativeRequired = Math.round(
      (pacing.totalLeadsRequired / 13) * (i + 1),
    );
    return {
      week: `W${row.weekNumber}`,
      weekLabel: formatWeekLabel(row.weekStart),
      actual: row.weekNumber <= currentWeek ? cumulativeActual : null,
      required: cumulativeRequired,
    };
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-white">Deal Creation Pacing</h2>

      {/* Cumulative chart */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="mb-4 text-sm font-medium text-slate-300">
          Cumulative Deals Created vs Required Pace
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="weekLabel" tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #475569',
                borderRadius: '8px',
                color: '#f1f5f9',
              }}
            />
            <ReferenceLine
              x={chartData[currentWeek - 1]?.weekLabel}
              stroke="#6366f1"
              strokeDasharray="3 3"
              label={{ value: 'Now', fill: '#818cf8', fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="required"
              stroke="#64748b"
              fill="none"
              strokeDasharray="6 3"
              name="Required Pace"
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.15}
              name="Actual"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Source breakdown table */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="mb-4 text-sm font-medium text-slate-300">Source Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4 text-right">Created</th>
                <th className="pb-3 pr-4 text-right">Required</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {pacing.sourceBreakdown.map((s) => (
                <tr key={s.source} className="border-b border-slate-700/50">
                  <td className="py-2.5 pr-4 text-slate-200">{s.source}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-200">{s.totalCreated}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-400">{s.requiredTotal}</td>
                  <td className="py-2.5 text-right">
                    <PaceStatusBadge status={s.paceStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-slate-300 font-medium">
                <td className="pt-3 pr-4">Total</td>
                <td className="pt-3 pr-4 text-right font-mono">{pacing.totalLeadsCreated}</td>
                <td className="pt-3 pr-4 text-right font-mono">{pacing.totalLeadsRequired}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function PaceStatusBadge({ status }: { status: 'ahead' | 'on_pace' | 'behind' }) {
  const styles = {
    ahead: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    on_pace: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    behind: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const labels = { ahead: 'Ahead', on_pace: 'On Pace', behind: 'Behind' };

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
