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
      <h2 className="text-lg font-semibold text-gray-900">Deal Creation Pacing</h2>

      {/* Cumulative chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-medium text-gray-700">
          Cumulative Deals Created vs Required Pace
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="weekLabel" tick={{ fill: '#6b7280', fontSize: 12 }} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                color: '#111827',
              }}
            />
            <ReferenceLine
              x={chartData[currentWeek - 1]?.weekLabel}
              stroke="#6366f1"
              strokeDasharray="3 3"
              label={{ value: 'Now', fill: '#6366f1', fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="required"
              stroke="#9ca3af"
              fill="none"
              strokeDasharray="6 3"
              name="Required Pace"
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.1}
              name="Actual"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Source breakdown table */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-medium text-gray-700">Source Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="pb-3 pr-4">Source</th>
                <th className="pb-3 pr-4 text-right">Created</th>
                <th className="pb-3 pr-4 text-right">Required</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {pacing.sourceBreakdown.map((s) => (
                <tr key={s.source} className="border-b border-gray-100">
                  <td className="py-2.5 pr-4 text-gray-900">{s.source}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-gray-900">{s.totalCreated}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-gray-500">{s.requiredTotal}</td>
                  <td className="py-2.5 text-right">
                    <PaceStatusBadge status={s.paceStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium text-gray-900">
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
    ahead: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    on_pace: 'bg-gray-50 text-gray-600 border-gray-200',
    behind: 'bg-red-50 text-red-700 border-red-200',
  };
  const labels = { ahead: 'Ahead', on_pace: 'On Pace', behind: 'Behind' };

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
