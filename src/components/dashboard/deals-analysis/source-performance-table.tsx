import type { SourceMetrics, SourceDetailMetrics } from '@/lib/analysis/types';

function cur(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
}

function pct(n: number | null): string {
  if (n === null) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}

function winRateColor(rate: number | null, total: number): string {
  if (rate === null || total < 3) return '';
  if (rate >= 0.2) return 'text-green-700 bg-green-50';
  if (rate >= 0.1) return 'text-yellow-700 bg-yellow-50';
  if (rate === 0) return 'text-red-700 bg-red-50';
  return 'text-orange-700 bg-orange-50';
}

interface Props {
  sources: SourceMetrics[];
  details: SourceDetailMetrics[];
  year: number;
}

export function SourcePerformanceTable({ sources, details, year }: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Lead Source Performance (Created in {year})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Source</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">Won</th>
                <th className="pb-2 text-right">Lost</th>
                <th className="pb-2 text-right">Open</th>
                <th className="pb-2 text-right">Win Rate</th>
                <th className="pb-2 text-right">Revenue</th>
                <th className="pb-2 text-right">Avg Deal</th>
                <th className="pb-2 text-right">Demo %</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => {
                const closed = s.won + s.lost;
                return (
                  <tr key={s.source} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{s.source}</td>
                    <td className="py-2 text-right">{s.total}</td>
                    <td className="py-2 text-right">{s.won}</td>
                    <td className="py-2 text-right">{s.lost}</td>
                    <td className="py-2 text-right">{s.open}</td>
                    <td className={`py-2 text-right font-medium ${winRateColor(s.winRate, closed)}`}>
                      {pct(s.winRate)}
                    </td>
                    <td className="py-2 text-right">{cur(s.wonRevenue)}</td>
                    <td className="py-2 text-right">{s.avgDealSize > 0 ? cur(s.avgDealSize) : '-'}</td>
                    <td className="py-2 text-right">{pct(s.demoRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Source Detail Breakdown */}
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Source Detail Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Source</th>
                <th className="pb-2">Detail</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">Won</th>
                <th className="pb-2 text-right">Win Rate</th>
                <th className="pb-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {details.map((d, i) => {
                const closed = d.won + d.lost;
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5">{d.source}</td>
                    <td className="py-1.5 text-gray-600">{d.detail}</td>
                    <td className="py-1.5 text-right">{d.total}</td>
                    <td className="py-1.5 text-right">{d.won}</td>
                    <td className={`py-1.5 text-right ${winRateColor(d.winRate, closed)}`}>
                      {pct(d.winRate)}
                    </td>
                    <td className="py-1.5 text-right">{cur(d.wonRevenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
