'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

type ForecastStage = 'arr' | 'sql' | 'demo' | 'proposal';

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
  stage: ForecastStage;
  stageLabel: string;
  unit: 'currency' | 'count';
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
  targets: {
    dealsNeeded: number;
    proposalsNeeded: number;
    demosNeeded: number;
    sqlsNeeded: number;
  };
  targetForStage?: number;
  weeks: WeekData[];
  summary: {
    currentWeek: number;
    forecastToDate: number;
    actualToDate: number;
    variance: number;
    percentOfForecast: number;
    status: 'ahead' | 'on_track' | 'behind' | 'at_risk';
    totalCount: number;
  };
}

interface ForecastChartProps {
  ownerId: string;
  defaultCollapsed?: boolean;
}

// Stage options for dropdown
const STAGE_OPTIONS: { value: ForecastStage; label: string }[] = [
  { value: 'arr', label: 'Closed Won ARR' },
  { value: 'sql', label: 'SQLs' },
  { value: 'demo', label: 'Demos Completed' },
  { value: 'proposal', label: 'Proposals' },
];

// Generate quarter options (current quarter only for now)
function getQuarterOptions(): Array<{ year: number; quarter: number; label: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  // Only show current quarter (as user requested)
  return [{ year: currentYear, quarter: currentQuarter, label: `Q${currentQuarter} ${currentYear}` }];
}

// Status colors
const STATUS_COLORS = {
  ahead: { bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-100' },
  on_track: { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-100' },
  behind: { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-100' },
  at_risk: { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-100' },
};

const STATUS_LABELS = {
  ahead: 'Ahead of Pace',
  on_track: 'On Track',
  behind: 'Behind Pace',
  at_risk: 'At Risk',
};

// Format value based on unit type
function formatValue(value: number, unit: 'currency' | 'count'): string {
  if (unit === 'currency') {
    return formatCurrency(value);
  }
  return value.toString();
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function ForecastChart({ ownerId, defaultCollapsed = true }: ForecastChartProps) {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<ForecastStage>('arr');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Quarter selection state
  const quarterOptions = getQuarterOptions();
  const [selectedQuarter, setSelectedQuarter] = useState(quarterOptions[0]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/ae/${ownerId}/forecast?year=${selectedQuarter.year}&quarter=${selectedQuarter.quarter}&stage=${selectedStage}`
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
  }, [ownerId, selectedQuarter, selectedStage]);

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
  const totalTarget = data.unit === 'currency' ? data.quota : (data.targetForStage || data.targets.sqlsNeeded);
  const maxValue = Math.max(
    ...data.weeks.map((w) => Math.max(w.forecast, w.actual)),
    totalTarget
  );

  // Get current week
  const today = new Date();
  const currentWeek = data.summary.currentWeek;

  // Status colors for the actual line
  const statusColor = STATUS_COLORS[data.summary.status];

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Collapsible Header - always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 rounded-xl transition-colors"
      >
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Forecast vs Actual</h3>
            {collapsed && (
              <p className="text-sm text-gray-500">
                {formatValue(data.summary.actualToDate, data.unit)} actual vs {formatValue(data.summary.forecastToDate, data.unit)} forecast
              </p>
            )}
            {!collapsed && (
              <p className="text-sm text-gray-500">Cumulative progress by week</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status Badge - always visible */}
          <div
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColor.light} ${statusColor.text}`}
          >
            {STATUS_LABELS[data.summary.status]}
          </div>
          <ChevronIcon expanded={!collapsed} />
        </div>
      </button>

      {/* Expandable content */}
      {!collapsed && (
        <div className="px-6 pb-6">
          {/* Controls row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* Quarter Selector */}
              <select
                value={`${selectedQuarter.year}-${selectedQuarter.quarter}`}
                onChange={(e) => {
                  const [year, quarter] = e.target.value.split('-').map(Number);
                  const option = quarterOptions.find((q) => q.year === year && q.quarter === quarter);
                  if (option) setSelectedQuarter(option);
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {quarterOptions.map((q) => (
                  <option key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              {/* Stage Selector */}
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value as ForecastStage)}
                onClick={(e) => e.stopPropagation()}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

      {/* Legend */}
      <div className="flex gap-6 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-300" />
          <span className="text-xs text-gray-600">Forecast</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-4 h-4 rounded ${statusColor.bg}`} />
          <span className="text-xs text-gray-600">Actual</span>
        </div>
        <div className="text-xs text-gray-500">
          Target: {data.unit === 'currency' ? formatCurrency(data.quota) : `${totalTarget} ${data.stageLabel}`}
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-56">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-6 w-16 flex flex-col justify-between text-xs text-gray-400">
          <span>{formatValue(maxValue, data.unit)}</span>
          <span>{formatValue(Math.round(maxValue * 0.75), data.unit)}</span>
          <span>{formatValue(Math.round(maxValue * 0.5), data.unit)}</span>
          <span>{formatValue(Math.round(maxValue * 0.25), data.unit)}</span>
          <span>{data.unit === 'currency' ? '$0' : '0'}</span>
        </div>

        {/* Chart area */}
        <div className="ml-16 h-full relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-gray-100 w-full" />
            ))}
          </div>

          {/* Target line (horizontal) */}
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-gray-400"
            style={{ bottom: `${(totalTarget / maxValue) * 100}%` }}
          />

          {/* Bars container */}
          <div className="absolute inset-0 flex items-end pb-6">
            {data.weeks.map((week) => {
              const isCurrent = week.weekNumber === currentWeek;
              const isFuture = new Date(week.weekStart) > today;
              const forecastHeight = maxValue > 0 ? (week.forecast / maxValue) * 100 : 0;
              const actualHeight = maxValue > 0 ? (week.actual / maxValue) * 100 : 0;

              return (
                <div
                  key={week.weekNumber}
                  className={`flex-1 flex flex-col items-center relative group ${
                    isFuture ? 'opacity-40' : ''
                  }`}
                >
                  {/* Bars */}
                  <div className="w-full h-44 relative flex items-end justify-center gap-1">
                    {/* Forecast bar (semi-transparent filled) */}
                    <div
                      className="w-4 rounded-t bg-gray-300 transition-all"
                      style={{ height: `${forecastHeight}%` }}
                    />
                    {/* Actual bar (solid colored) */}
                    <div
                      className={`w-4 rounded-t transition-all ${
                        isFuture ? 'bg-gray-200' : statusColor.bg
                      }`}
                      style={{ height: `${actualHeight}%` }}
                    />

                    {/* Tooltip on hover */}
                    <div className="absolute -top-24 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-2 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none min-w-[140px]">
                      <div className="font-medium mb-1">Week {week.weekNumber}</div>
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Forecast:</span>
                        <span>{formatValue(week.forecast, data.unit)}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-gray-400">Actual:</span>
                        <span>{formatValue(week.actual, data.unit)}</span>
                      </div>
                      <div
                        className={`flex justify-between gap-4 mt-1 pt-1 border-t border-gray-700 ${
                          week.variance >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        <span>Variance:</span>
                        <span>
                          {week.variance >= 0 ? '+' : ''}
                          {formatValue(week.variance, data.unit)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Week label */}
                  <div
                    className={`text-xs font-medium mt-1 ${
                      isCurrent ? 'text-blue-600 font-bold' : 'text-gray-500'
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
              {formatValue(data.summary.actualToDate, data.unit)}
            </div>
            <div className="text-xs text-gray-500">Actual to Date</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-gray-400">
              {formatValue(data.summary.forecastToDate, data.unit)}
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
              {formatValue(data.summary.variance, data.unit)}
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

          {/* Stage targets info (only show for non-ARR stages) */}
          {data.stage !== 'arr' && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs text-gray-500 text-center">
                Based on {formatCurrency(data.quota)} quota with $12K avg deal size:
                Need {data.targets.sqlsNeeded} SQLs → {data.targets.demosNeeded} Demos → {data.targets.proposalsNeeded} Proposals → {data.targets.dealsNeeded} Deals
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
