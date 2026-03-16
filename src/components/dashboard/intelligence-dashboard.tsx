'use client';

import { useEffect, useState } from 'react';
import { HeatmapDrillDownModal } from './heatmap-drill-down-modal';

interface HeatmapCell {
  hour: number;
  hourLabel: string;
  total: number;
  connected: number;
  rate: number;
}

interface HeatmapRow {
  day: string;
  hours: HeatmapCell[];
}

interface SpotData {
  day: string;
  hour: number;
  hourLabel: string;
  total: number;
  connected: number;
  rate: number;
}

interface AEData {
  name: string;
  total: number;
  connected: number;
  rate: number;
  bestHour: string;
  bestHourRate: number;
}

interface CallPatternsData {
  totalCalls: number;
  totalConnected: number;
  overallConnectRate: number;
  dateRange: { from: string; to: string } | null;
  heatmap: HeatmapRow[];
  hourly: Array<{ hour: number; hourLabel: string; total: number; connected: number; rate: number }>;
  daily: Array<{ day: string; total: number; connected: number; rate: number }>;
  sweetSpots: SpotData[];
  worstSpots: SpotData[];
  bestHour: { hourLabel: string; rate: number; total: number } | null;
  bestDay: { day: string; rate: number; total: number } | null;
  perAE: AEData[];
}

function getCellColor(rate: number, total: number, avgRate: number): string {
  if (total < 10) return 'bg-gray-100 text-gray-400';
  const ratio = rate / avgRate;
  if (ratio >= 1.5) return 'bg-emerald-500 text-white';
  if (ratio >= 1.0) return 'bg-emerald-300 text-emerald-900';
  if (ratio >= 0.7) return 'bg-amber-300 text-amber-900';
  return 'bg-red-300 text-red-900';
}

export function IntelligenceDashboard() {
  const [data, setData] = useState<CallPatternsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{ day: string; hour: number; hourLabel: string } | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/dashboard/call-patterns');
        if (!response.ok) {
          throw new Error('Failed to fetch call patterns');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            <div className="h-20 bg-gray-200 rounded-xl"></div>
            <div className="h-20 bg-gray-200 rounded-xl"></div>
            <div className="h-20 bg-gray-200 rounded-xl"></div>
            <div className="h-20 bg-gray-200 rounded-xl"></div>
          </div>
          <div className="h-80 bg-gray-200 rounded-xl"></div>
          <div className="grid grid-cols-4 gap-4">
            <div className="h-24 bg-gray-200 rounded-xl"></div>
            <div className="h-24 bg-gray-200 rounded-xl"></div>
            <div className="h-24 bg-gray-200 rounded-xl"></div>
            <div className="h-24 bg-gray-200 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
          <h3 className="font-medium">Error loading call intelligence</h3>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.totalCalls === 0) {
    return (
      <div className="p-8">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
          <h3 className="font-medium text-gray-900">No Call Data</h3>
          <p className="mt-1 text-sm text-gray-500">No outbound calls found to analyze.</p>
        </div>
      </div>
    );
  }

  const avgRate = data.overallConnectRate;
  const topSweet = data.sweetSpots[0];
  const topWorst = data.worstSpots[0];

  return (
    <div className="p-8 bg-gray-50 min-h-full">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Call Intelligence</h2>
        <p className="text-sm text-gray-500">
          {data.totalCalls.toLocaleString()} outbound calls analyzed
          {data.dateRange && ` | ${data.dateRange.from} to ${data.dateRange.to}`}
          {' | '}Overall connect rate: {avgRate.toFixed(1)}%
        </p>
      </div>

      {/* Key Insight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {data.bestHour && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Best Hour</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{data.bestHour.hourLabel}</div>
            <div className="text-sm text-emerald-600 mt-1">
              {data.bestHour.rate.toFixed(1)}% connect rate ({data.bestHour.total} calls)
            </div>
          </div>
        )}
        {data.bestDay && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Best Day</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{data.bestDay.day}</div>
            <div className="text-sm text-emerald-600 mt-1">
              {data.bestDay.rate.toFixed(1)}% connect rate ({data.bestDay.total} calls)
            </div>
          </div>
        )}
        {topSweet && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sweet Spot</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{topSweet.day.slice(0, 3)} {topSweet.hourLabel}</div>
            <div className="text-sm text-emerald-600 mt-1">
              {topSweet.rate.toFixed(1)}% connect rate ({topSweet.total} calls)
            </div>
          </div>
        )}
        {topWorst && (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Time to Avoid</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{topWorst.day.slice(0, 3)} {topWorst.hourLabel}</div>
            <div className="text-sm text-red-600 mt-1">
              {topWorst.rate.toFixed(1)}% connect rate ({topWorst.total} calls)
            </div>
          </div>
        )}
      </div>

      {/* Heatmap */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Connect Rate Heatmap</h3>
        <p className="text-sm text-gray-500 mb-4">Day x Hour (EST) — cells show connect rate %. Gray = insufficient data (&lt;10 calls).</p>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 pb-2 pr-2 w-20">Day</th>
                {data.heatmap[0]?.hours.map((cell) => (
                  <th key={cell.hour} className="text-center text-xs font-medium text-gray-500 pb-2 px-1 min-w-[60px]">
                    {cell.hourLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.heatmap.map((row) => (
                <tr key={row.day}>
                  <td className="text-sm font-medium text-gray-700 py-1 pr-2">{row.day.slice(0, 3)}</td>
                  {row.hours.map((cell) => {
                    const clickable = cell.total >= 10;
                    return (
                      <td key={cell.hour} className="py-1 px-1">
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={() => clickable && setDrillDown({ day: row.day, hour: cell.hour, hourLabel: cell.hourLabel })}
                          className={`w-full rounded-md text-center py-2 px-1 text-xs font-medium ${getCellColor(cell.rate, cell.total, avgRate)} ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition-shadow' : 'cursor-default'}`}
                          title={`${row.day} ${cell.hourLabel}: ${cell.total} calls, ${cell.connected} connected${clickable ? ' — click to view' : ''}`}
                        >
                          {cell.total < 10 ? '--' : `${cell.rate.toFixed(0)}%`}
                          {cell.total >= 10 && (
                            <div className="text-[10px] opacity-75 font-normal">{cell.total}</div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
          <span>Color scale:</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-300 inline-block"></span> &lt;0.7x avg</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-300 inline-block"></span> 0.7-1x avg</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-300 inline-block"></span> 1-1.5x avg</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> &gt;1.5x avg</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block"></span> &lt;10 calls</span>
        </div>
      </div>

      {/* Top Sweet Spots & Worst Spots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Top 5 Sweet Spots</h3>
          <div className="space-y-2">
            {data.sweetSpots.map((spot, i) => (
              <div key={`${spot.day}-${spot.hour}`} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <span className="text-sm font-medium text-gray-900">{spot.day} {spot.hourLabel}</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-emerald-600">{spot.rate.toFixed(1)}%</span>
                  <span className="text-gray-400 ml-2">({spot.total} calls)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Bottom 5 (Times to Avoid)</h3>
          <div className="space-y-2">
            {data.worstSpots.map((spot, i) => (
              <div key={`${spot.day}-${spot.hour}`} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <span className="text-sm font-medium text-gray-900">{spot.day} {spot.hourLabel}</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-red-600">{spot.rate.toFixed(1)}%</span>
                  <span className="text-gray-400 ml-2">({spot.total} calls)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-AE Table */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Per-AE Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide py-3">AE Name</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wide py-3">Total Calls</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wide py-3">Connected</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wide py-3">Connect Rate</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wide py-3">Best Hour</th>
              </tr>
            </thead>
            <tbody>
              {data.perAE.map((ae) => (
                <tr key={ae.name} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 text-sm font-medium text-gray-900">{ae.name}</td>
                  <td className="py-3 text-sm text-gray-600 text-right">{ae.total.toLocaleString()}</td>
                  <td className="py-3 text-sm text-gray-600 text-right">{ae.connected.toLocaleString()}</td>
                  <td className="py-3 text-sm text-right">
                    <span className={ae.rate >= avgRate ? 'text-emerald-600 font-medium' : 'text-gray-600'}>
                      {ae.rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 text-sm text-gray-600 text-right">
                    {ae.bestHour}
                    {ae.bestHourRate > 0 && (
                      <span className="text-gray-400 ml-1">({ae.bestHourRate.toFixed(0)}%)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Heatmap Drill-Down Modal */}
      <HeatmapDrillDownModal
        isOpen={drillDown !== null}
        onClose={() => setDrillDown(null)}
        day={drillDown?.day ?? ''}
        hour={drillDown?.hour ?? 0}
        hourLabel={drillDown?.hourLabel ?? ''}
      />
    </div>
  );
}
