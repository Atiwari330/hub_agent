'use client';

import type { SourceDemoRow } from '@/lib/command-center/types';

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

interface SourceDemoBreakdownProps {
  rows: SourceDemoRow[];
}

export function SourceDemoBreakdown({ rows }: SourceDemoBreakdownProps) {
  const totalScheduled = rows.reduce((s, r) => s + r.demosScheduled, 0);
  const totalCompleted = rows.reduce((s, r) => s + r.demosCompleted, 0);
  const totalRate = totalScheduled > 0 ? totalCompleted / totalScheduled : 0;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Demo Breakdown by Source — Q2</h2>
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4 text-right">Demos Scheduled</th>
                <th className="pb-3 pr-4 text-right">Demos Completed</th>
                <th className="pb-3 text-right">Sched → Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={4}>
                    No demo activity in Q2 yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.source} className="border-b border-gray-100">
                    <td className="py-2.5 pr-4 text-gray-900">{r.source}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-gray-900">{r.demosScheduled}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-gray-900">{r.demosCompleted}</td>
                    <td className="py-2.5 text-right font-mono text-gray-500">
                      {r.demosScheduled > 0 ? formatPct(r.completionRate) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-medium text-gray-900">
                  <td className="pt-3 pr-4">Total</td>
                  <td className="pt-3 pr-4 text-right font-mono">{totalScheduled}</td>
                  <td className="pt-3 pr-4 text-right font-mono">{totalCompleted}</td>
                  <td className="pt-3 text-right font-mono text-gray-500">
                    {totalScheduled > 0 ? formatPct(totalRate) : '—'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
