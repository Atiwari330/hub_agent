'use client';

import type { WeeklyPacingRow } from '@/lib/command-center/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  return `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`;
}

interface WeeklyOperatingTableProps {
  weeklyRows: WeeklyPacingRow[];
  currentWeek: number;
}

export function WeeklyOperatingTable({ weeklyRows, currentWeek }: WeeklyOperatingTableProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Weekly Operating View</h2>
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Week</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3 text-right">Deals Created</th>
              <th className="px-4 py-3 text-right">Demos Completed</th>
              <th className="px-4 py-3 text-right">Closed Won</th>
              <th className="px-4 py-3 text-right">Closed Won ARR</th>
            </tr>
          </thead>
          <tbody>
            {weeklyRows.map((row) => {
              const isCurrent = row.weekNumber === currentWeek;
              const isFuture = row.weekNumber > currentWeek;
              const isPast = row.weekNumber < currentWeek;
              const isEmpty = isPast && row.leadsCreated === 0 && row.dealsToDemo === 0 && row.closedWonCount === 0;

              let rowClass = 'border-b border-slate-700/50';
              if (isCurrent) rowClass += ' bg-indigo-500/10';
              else if (isFuture) rowClass += ' opacity-40';
              else if (isEmpty) rowClass += ' bg-amber-500/5';

              return (
                <tr key={row.weekNumber} className={rowClass}>
                  <td className="px-4 py-2.5 font-medium text-slate-200">
                    W{row.weekNumber}
                    {isCurrent && (
                      <span className="ml-2 inline-block rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-300">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{formatDateRange(row.weekStart, row.weekEnd)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                    {isFuture ? '–' : row.leadsCreated}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                    {isFuture ? '–' : row.dealsToDemo}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                    {isFuture ? '–' : row.closedWonCount}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                    {isFuture ? '–' : fmt(row.closedWonARR)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium text-slate-300">
              <td className="px-4 pt-3 pb-4" colSpan={2}>Total</td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.leadsCreated, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.dealsToDemo, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.closedWonCount, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {fmt(weeklyRows.reduce((s, r) => s + r.closedWonARR, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
