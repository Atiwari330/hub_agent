'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { FunnelStage, StageTransition } from '@/lib/analysis/types';

function pct(n: number | null): string {
  if (n === null) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe'];

interface Props {
  stages: FunnelStage[];
  transitions: StageTransition[];
  totalDeals: number;
}

export function FunnelChart({ stages, transitions, totalDeals }: Props) {
  const chartData = stages.map(s => ({
    stage: s.stage,
    deals: s.reached,
    pct: s.pctOfTotal,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Funnel Progression ({totalDeals} deals)
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 40 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" />
              <YAxis type="category" dataKey="stage" width={90} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) =>
                  [`${value} deals`, 'Reached']
                }
              />
              <Bar dataKey="deals" radius={[0, 4, 4, 0]}>
                {chartData.map((_entry, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stage Transitions Table */}
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Stage-to-Stage Conversion</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2">Transition</th>
              <th className="pb-2 text-right">Rate</th>
              <th className="pb-2 text-right">Avg Days</th>
              <th className="pb-2 text-right">Median Days</th>
              <th className="pb-2 text-right">Sample</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map(t => (
              <tr key={`${t.from}-${t.to}`} className="border-b border-gray-100">
                <td className="py-1.5">
                  {t.from} <span className="text-gray-400">→</span> {t.to}
                </td>
                <td className="py-1.5 text-right font-medium">{pct(t.rate)}</td>
                <td className="py-1.5 text-right">
                  {t.avgDays !== null ? t.avgDays.toFixed(1) : '-'}
                </td>
                <td className="py-1.5 text-right">
                  {t.medianDays !== null ? t.medianDays.toFixed(1) : '-'}
                </td>
                <td className="py-1.5 text-right text-gray-400">n={t.sampleSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
