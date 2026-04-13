import type { DealsAnalysisResult } from '@/lib/analysis/types';

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
  data: DealsAnalysisResult;
}

export function RevenueSummary({ data }: Props) {
  const { revenue, conversion } = data;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-sm text-gray-500">Revenue (Closed in {data.year})</p>
          <p className="text-2xl font-bold text-green-600">{cur(revenue.totalRevenue)}</p>
          <p className="text-xs text-gray-400">{revenue.totalDeals} deals (deduped)</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-sm text-gray-500">Avg Deal Size</p>
          <p className="text-2xl font-bold">{cur(revenue.avgDealSize)}</p>
          <p className="text-xs text-gray-400">Median: {cur(revenue.medianDealSize)}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-sm text-gray-500">Win Rate (of closed)</p>
          <p className="text-2xl font-bold">{pct(conversion.winRateOfClosed)}</p>
          <p className="text-xs text-gray-400">
            {conversion.closedWon}W / {conversion.closedLost}L
          </p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-sm text-gray-500">Open Pipeline</p>
          <p className="text-2xl font-bold text-blue-600">{cur(conversion.openPipeline)}</p>
          <p className="text-xs text-gray-400">{conversion.stillOpen} deals open</p>
        </div>
      </div>

      {/* Revenue by Month */}
      <div className="rounded-lg bg-white p-4 shadow">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Revenue by Month</h3>
        <div className="space-y-2">
          {revenue.byMonth.map(m => {
            const maxRev = Math.max(...revenue.byMonth.map(x => x.revenue));
            const widthPct = maxRev > 0 ? (m.revenue / maxRev) * 100 : 0;
            return (
              <div key={m.month} className="flex items-center gap-3">
                <span className="w-16 text-sm text-gray-600">{m.month}</span>
                <div className="flex-1">
                  <div
                    className="h-6 rounded bg-green-500"
                    style={{ width: `${widthPct}%`, minWidth: widthPct > 0 ? '2px' : '0' }}
                  />
                </div>
                <span className="w-20 text-right text-sm font-medium">{cur(m.revenue)}</span>
                <span className="w-12 text-right text-xs text-gray-400">{m.deals}d</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Revenue by AE + Source side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Revenue by AE</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">AE</th>
                <th className="pb-2 text-right">Deals</th>
                <th className="pb-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {revenue.byAE.map(a => (
                <tr key={a.email || a.name} className="border-b border-gray-100">
                  <td className="py-1.5">{a.name}</td>
                  <td className="py-1.5 text-right">{a.deals}</td>
                  <td className="py-1.5 text-right font-medium">{cur(a.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Revenue by Source</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Source</th>
                <th className="pb-2 text-right">Deals</th>
                <th className="pb-2 text-right">Revenue</th>
                <th className="pb-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {revenue.bySource.map(s => (
                <tr key={s.source} className="border-b border-gray-100">
                  <td className="py-1.5">{s.source}</td>
                  <td className="py-1.5 text-right">{s.deals}</td>
                  <td className="py-1.5 text-right font-medium">{cur(s.revenue)}</td>
                  <td className="py-1.5 text-right text-gray-500">{pct(s.pctOfRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
