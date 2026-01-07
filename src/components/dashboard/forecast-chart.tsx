'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface WeekData {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  forecast: number;
  actual: number;
  weeklyActual: number;
  weeklyForecast: number;
  variance: number;
  percentOfForecast: number;
  status: 'ahead' | 'on_track' | 'behind' | 'at_risk';
}

interface ForecastData {
  owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  quarter: {
    year: number;
    quarter: number;
    label: string;
    startDate: string;
    endDate: string;
  };
  quota: number;
  weeks: WeekData[];
  summary: {
    currentWeek: number;
    forecastToDate: number;
    actualToDate: number;
    variance: number;
    percentOfForecast: number;
    status: 'ahead' | 'on_track' | 'behind' | 'at_risk';
    totalDeals: number;
  };
}

interface ForecastChartProps {
  ownerId: string;
}

// Generate quarter options (current + 3 previous)
function getQuarterOptions(): Array<{ year: number; quarter: number; label: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  const options: Array<{ year: number; quarter: number; label: string }> = [];
  let year = currentYear;
  let quarter = currentQuarter;

  for (let i = 0; i < 4; i++) {
    options.push({ year, quarter, label: `Q${quarter} ${year}` });
    quarter--;
    if (quarter < 1) {
      quarter = 4;
      year--;
    }
  }

  return options;
}

// Status colors
const STATUS_COLORS = {
  ahead: { bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50' },
  on_track: { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50' },
  behind: { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50' },
  at_risk: { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-50' },
};

const STATUS_LABELS = {
  ahead: 'Ahead of Pace',
  on_track: 'On Track',
  behind: 'Behind Pace',
  at_risk: 'At Risk',
};

export function ForecastChart({ ownerId }: ForecastChartProps) {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quarter selection state
  const quarterOptions = getQuarterOptions();
  const [selectedQuarter, setSelectedQuarter] = useState(quarterOptions[0]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/ae/${ownerId}/forecast?year=${selectedQuarter.year}&quarter=${selectedQuarter.quarter}`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch forecast data');
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
  }, [ownerId, selectedQuarter]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-red-500">Failed to load forecast data</div>
      </div>
    );
  }

  // Calculate chart dimensions
  const maxValue = Math.max(
    ...data.weeks.map((w) => Math.max(w.forecast, w.actual)),
    data.quota
  );

  // Get current week
  const today = new Date();
  const currentWeek = data.summary.currentWeek;

  // Status colors for the actual line
  const statusColor = STATUS_COLORS[data.summary.status];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Forecast vs Actual</h3>
            <p className="text-sm text-gray-500">Cumulative closed-won ARR</p>
          </div>
          {/* Quarter Selector */}
          <select
            value={`${selectedQuarter.year}-${selectedQuarter.quarter}`}
            onChange={(e) => {
              const [year, quarter] = e.target.value.split('-').map(Number);
              const option = quarterOptions.find((q) => q.year === year && q.quarter === quarter);
              if (option) setSelectedQuarter(option);
            }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {quarterOptions.map((q) => (
              <option key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>
                {q.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status Badge */}
        <div
          className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColor.light} ${statusColor.text}`}
        >
          {STATUS_LABELS[data.summary.status]}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-6 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 bg-gray-400 border-dashed border-t-2 border-gray-400" />
          <span className="text-xs text-gray-600">Forecast</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-8 h-1 rounded ${statusColor.bg}`} />
          <span className="text-xs text-gray-600">Actual</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-300" />
          <span className="text-xs text-gray-600">Quota: {formatCurrency(data.quota)}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-56">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-6 w-16 flex flex-col justify-between text-xs text-gray-400">
          <span>{formatCurrency(maxValue)}</span>
          <span>{formatCurrency(maxValue * 0.75)}</span>
          <span>{formatCurrency(maxValue * 0.5)}</span>
          <span>{formatCurrency(maxValue * 0.25)}</span>
          <span>$0</span>
        </div>

        {/* Chart area */}
        <div className="ml-16 h-full relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-gray-100 w-full" />
            ))}
          </div>

          {/* Quota line */}
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-gray-300"
            style={{ bottom: `${(data.quota / maxValue) * 100}%` }}
          />

          {/* Bars container */}
          <div className="absolute inset-0 flex items-end pb-6">
            {data.weeks.map((week) => {
              const isCurrent = week.weekNumber === currentWeek;
              const isFuture = new Date(week.weekStart) > today;
              const forecastHeight = (week.forecast / maxValue) * 100;
              const actualHeight = (week.actual / maxValue) * 100;

              return (
                <div
                  key={week.weekNumber}
                  className={`flex-1 flex flex-col items-center relative group ${
                    isFuture ? 'opacity-40' : ''
                  }`}
                >
                  {/* Bars */}
                  <div className="w-full h-44 relative flex items-end justify-center gap-1">
                    {/* Forecast bar (outline only) */}
                    <div
                      className="w-3 border-2 border-dashed border-gray-400 rounded-t bg-gray-50"
                      style={{ height: `${forecastHeight}%` }}
                    />
                    {/* Actual bar (solid) */}
                    <div
                      className={`w-3 rounded-t ${
                        isFuture ? 'bg-gray-200' : statusColor.bg
                      } transition-all`}
                      style={{ height: `${actualHeight}%` }}
                    />

                    {/* Tooltip on hover */}
                    <div className="absolute -top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-2 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                      <div className="font-medium mb-1">Week {week.weekNumber}</div>
                      <div>Forecast: {formatCurrency(week.forecast)}</div>
                      <div>Actual: {formatCurrency(week.actual)}</div>
                      <div
                        className={
                          week.variance >= 0 ? 'text-emerald-300' : 'text-red-300'
                        }
                      >
                        {week.variance >= 0 ? '+' : ''}
                        {formatCurrency(week.variance)}
                      </div>
                    </div>
                  </div>

                  {/* Week label */}
                  <div
                    className={`text-xs font-medium mt-1 ${
                      isCurrent ? 'text-blue-600' : 'text-gray-500'
                    }`}
                  >
                    W{week.weekNumber}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-semibold text-gray-900">
              {formatCurrency(data.summary.actualToDate)}
            </div>
            <div className="text-xs text-gray-500">Actual to Date</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-gray-500">
              {formatCurrency(data.summary.forecastToDate)}
            </div>
            <div className="text-xs text-gray-500">Forecast to Date</div>
          </div>
          <div className="text-center">
            <div
              className={`text-2xl font-semibold ${
                data.summary.variance >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {data.summary.variance >= 0 ? '+' : ''}
              {formatCurrency(data.summary.variance)}
            </div>
            <div className="text-xs text-gray-500">Variance</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-semibold ${statusColor.text}`}>
              {data.summary.percentOfForecast}%
            </div>
            <div className="text-xs text-gray-500">of Forecast</div>
          </div>
        </div>
      </div>
    </div>
  );
}
