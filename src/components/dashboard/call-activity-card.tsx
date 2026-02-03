'use client';

import { useEffect, useState } from 'react';
import type { CallActivityResponse, CallPeriod } from '@/types/calls';
import { CallDrillDownModal } from './call-drill-down-modal';

interface CallActivityCardProps {
  ownerId: string;
}

interface DrillDownState {
  isOpen: boolean;
  filterType: 'date' | 'outcome';
  filterValue: string;
}

const PERIOD_OPTIONS: Array<{ value: CallPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'quarter', label: 'Quarter' },
];

const OUTCOME_DISPLAY: Record<string, { label: string; color: string; bgClass: string }> = {
  connected: { label: 'Connected', color: '#10b981', bgClass: 'bg-emerald-500' },
  leftVoicemail: { label: 'Voicemail', color: '#f59e0b', bgClass: 'bg-amber-500' },
  leftLiveMessage: { label: 'Live Msg', color: '#fbbf24', bgClass: 'bg-amber-400' },
  noAnswer: { label: 'No Answer', color: '#9ca3af', bgClass: 'bg-gray-400' },
  busy: { label: 'Busy', color: '#6b7280', bgClass: 'bg-gray-500' },
  wrongNumber: { label: 'Wrong #', color: '#ef4444', bgClass: 'bg-red-400' },
  unknown: { label: 'Other', color: '#d1d5db', bgClass: 'bg-gray-300' },
};

export function CallActivityCard({ ownerId }: CallActivityCardProps) {
  const [data, setData] = useState<CallActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<CallPeriod>('today');
  const [customDate, setCustomDate] = useState<string>(''); // YYYY-MM-DD format
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Used to trigger re-fetch
  const [drillDown, setDrillDown] = useState<DrillDownState>({
    isOpen: false,
    filterType: 'date',
    filterValue: '',
  });

  const openDrillDown = (filterType: 'date' | 'outcome', filterValue: string) => {
    setDrillDown({ isOpen: true, filterType, filterValue });
  };

  const closeDrillDown = () => {
    setDrillDown((prev) => ({ ...prev, isOpen: false }));
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleCustomDateChange = (dateValue: string) => {
    setCustomDate(dateValue);
    setPeriod('custom');
    setShowDatePicker(false);
  };

  const handlePeriodClick = (newPeriod: CallPeriod) => {
    setPeriod(newPeriod);
    if (newPeriod !== 'custom') {
      setCustomDate('');
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        let url = `/api/ae/${ownerId}/calls?period=${period}`;
        if (period === 'custom' && customDate) {
          url += `&customDate=${customDate}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch call activity');
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    // Only fetch if we have a valid period (custom requires a date)
    if (period !== 'custom' || customDate) {
      fetchData();
    }
  }, [ownerId, period, customDate, refreshKey]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4" />
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded" />
            ))}
          </div>
          <div className="h-8 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-red-500">Failed to load call activity: {error}</div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Calculate outcome percentages for the breakdown bar
  const totalCalls = data.summary.totalCalls;
  const outcomePercentages = Object.entries(data.outcomeBreakdown)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      count,
      percent: totalCalls > 0 ? (count / totalCalls) * 100 : 0,
      ...OUTCOME_DISPLAY[key],
    }))
    .sort((a, b) => {
      // Sort order: connected first, then by count
      if (a.key === 'connected') return -1;
      if (b.key === 'connected') return 1;
      return b.count - a.count;
    });

  // Daily trend chart calculations
  const showTrend = period !== 'today' && data.dailyTrend.length > 0;
  const maxCalls = showTrend ? Math.max(...data.dailyTrend.map((d) => d.calls), 1) : 1;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header with period selector */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Call Activity</h3>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
            title="Refresh call data"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handlePeriodClick(option.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                period === option.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
          {/* Custom date display when selected */}
          {period === 'custom' && customDate && (
            <span className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white">
              {new Date(customDate + 'T12:00:00').toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
          {/* Date picker toggle */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker(!showDatePicker)}
              className={`p-1.5 rounded-lg transition ${
                showDatePicker || period === 'custom'
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Pick a specific date"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </button>
            {/* Date picker dropdown */}
            {showDatePicker && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-20">
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => handleCustomDateChange(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Calls"
          value={data.summary.totalCalls.toString()}
          color="text-gray-900"
        />
        <MetricCard
          label="Connected"
          value={data.summary.connectedCalls.toString()}
          color="text-emerald-600"
        />
        <MetricCard
          label="Connect Rate"
          value={`${data.summary.connectRate.toFixed(0)}%`}
          color="text-blue-600"
        />
        <MetricCard
          label="Avg Duration"
          value={data.summary.avgDurationFormatted}
          sublabel="(connected)"
          color="text-purple-600"
        />
      </div>

      {/* Outcome Breakdown */}
      {totalCalls > 0 && (
        <div className="mb-6">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Outcome Breakdown
          </div>

          {/* Stacked horizontal bar */}
          <div className="h-8 flex rounded-lg overflow-hidden mb-2">
            {outcomePercentages.map((outcome) => (
              <button
                key={outcome.key}
                onClick={() => openDrillDown('outcome', outcome.key)}
                className={`${outcome.bgClass} relative group flex items-center justify-center transition-all hover:opacity-90 cursor-pointer`}
                style={{ width: `${outcome.percent}%` }}
                title={`View ${outcome.label} calls`}
              >
                {outcome.percent >= 10 && (
                  <span className="text-xs font-medium text-white truncate px-1">
                    {outcome.count}
                  </span>
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                  {outcome.label}: {outcome.count} ({outcome.percent.toFixed(0)}%) - Click to view
                </div>
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3">
            {outcomePercentages.map((outcome) => (
              <div key={outcome.key} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded ${outcome.bgClass}`} />
                <span className="text-xs text-gray-600">
                  {outcome.label} ({outcome.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalCalls === 0 && (
        <div className="text-center py-6 text-gray-500">
          No calls recorded for {data.period.label.toLowerCase()}
        </div>
      )}

      {/* Daily Trend Chart */}
      {showTrend && totalCalls > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Daily Trend
          </div>
          <div className="flex items-end gap-1 h-32">
            {data.dailyTrend.map((day) => {
              // Add T12:00:00 to parse as noon local time, avoiding UTC midnight shift
              const dayDate = new Date(day.date + 'T12:00:00');
              const isToday =
                dayDate.toDateString() === new Date().toDateString();
              const dayLabel = dayDate.toLocaleDateString('en-US', {
                weekday: 'short',
              });
              const dateLabel = dayDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  {/* Stacked bar: connected (green) on top of not connected (gray) */}
                  <div className="w-full flex flex-col items-center h-24">
                    {day.calls > 0 ? (
                      <button
                        onClick={() => openDrillDown('date', day.date)}
                        className="w-full flex flex-col justify-end relative group cursor-pointer hover:opacity-90 transition-opacity"
                        style={{
                          height: `${(day.calls / maxCalls) * 100}%`,
                        }}
                        title={`View calls for ${day.date}`}
                      >
                        {/* Not connected portion */}
                        {day.calls - day.connected > 0 && (
                          <div
                            className="w-full bg-gray-300 rounded-t"
                            style={{
                              height: `${((day.calls - day.connected) / day.calls) * 100}%`,
                            }}
                          />
                        )}
                        {/* Connected portion */}
                        {day.connected > 0 && (
                          <div
                            className={`w-full bg-emerald-500 ${
                              day.calls - day.connected > 0 ? '' : 'rounded-t'
                            }`}
                            style={{
                              height: `${(day.connected / day.calls) * 100}%`,
                            }}
                          />
                        )}
                        {/* Tooltip */}
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                          {day.calls} calls ({day.connected} connected) - Click to view
                        </div>
                      </button>
                    ) : (
                      <div className="w-full h-1 bg-gray-100 rounded mt-auto" />
                    )}
                  </div>

                  {/* Date label */}
                  <div
                    className={`text-[10px] text-center ${
                      isToday ? 'text-blue-600 font-medium' : 'text-gray-500'
                    }`}
                  >
                    {period === 'this_week' || period === 'last_week' ? dayLabel : dateLabel}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trend Legend */}
          <div className="flex gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-emerald-500" />
              <span className="text-xs text-gray-600">Connected</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-gray-300" />
              <span className="text-xs text-gray-600">Not Connected</span>
            </div>
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      <CallDrillDownModal
        isOpen={drillDown.isOpen}
        onClose={closeDrillDown}
        ownerId={ownerId}
        period={period}
        periodLabel={data?.period.label || ''}
        filterType={drillDown.filterType}
        filterValue={drillDown.filterValue}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
  color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  color: string;
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 text-center">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mt-1">
        {label}
        {sublabel && <span className="lowercase font-normal"> {sublabel}</span>}
      </div>
    </div>
  );
}
