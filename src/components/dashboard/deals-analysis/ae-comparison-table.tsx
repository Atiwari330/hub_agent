import type { AEMetrics } from '@/lib/analysis/types';

function cur(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
}

function pct(n: number | null): string {
  if (n === null) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}

interface Props {
  aeData: AEMetrics[];
  year: number;
}

export function AEComparisonTable({ aeData, year }: Props) {
  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        AE Performance (Created in {year})
      </h3>
      <div className="space-y-6">
        {aeData.map(ae => (
          <div key={ae.ownerId} className="border-b border-gray-200 pb-4 last:border-0">
            <div className="mb-2 flex items-baseline justify-between">
              <div>
                <span className="font-semibold">{ae.name}</span>
                {ae.email && (
                  <span className="ml-2 text-xs text-gray-400">{ae.email}</span>
                )}
              </div>
              <span className="text-sm font-medium text-green-600">{cur(ae.wonRevenue)}</span>
            </div>

            {/* Stats row */}
            <div className="mb-2 flex gap-4 text-sm text-gray-600">
              <span>{ae.total} deals</span>
              <span>{ae.won} won</span>
              <span>{ae.lost} lost</span>
              <span>{ae.open} open</span>
              <span className="font-medium">Win: {pct(ae.winRate)}</span>
              {ae.avgDaysToClose !== null && (
                <span>Avg {ae.avgDaysToClose.toFixed(0)}d to close</span>
              )}
            </div>

            {/* Source breakdown */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">Source</th>
                    <th className="pb-1 text-right">Total</th>
                    <th className="pb-1 text-right">Won</th>
                    <th className="pb-1 text-right">Lost</th>
                    <th className="pb-1 text-right">Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {ae.sourceBreakdown.map(s => (
                    <tr key={s.source} className="border-t border-gray-50">
                      <td className="py-1">{s.source}</td>
                      <td className="py-1 text-right">{s.total}</td>
                      <td className="py-1 text-right">{s.won}</td>
                      <td className="py-1 text-right">{s.lost}</td>
                      <td className="py-1 text-right">{pct(s.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
