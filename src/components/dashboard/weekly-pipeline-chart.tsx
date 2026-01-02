'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface WeekData {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  sql: number;
  demoScheduled: number;
  demoCompleted: number;
  closedWon: number;
  closedWonAmount: number;
}

interface WeeklyPipelineData {
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
  target: {
    amount: number;
    closedAmount: number;
    percentComplete: number;
    onTrack: boolean;
  };
  weeks: WeekData[];
  totals: {
    sql: number;
    demoScheduled: number;
    demoCompleted: number;
    closedWon: number;
    closedWonAmount: number;
  };
}

interface WeeklyPipelineChartProps {
  ownerId: string;
}

const STAGE_COLORS = {
  sql: 'bg-blue-500',
  demoScheduled: 'bg-yellow-500',
  demoCompleted: 'bg-purple-500',
  closedWon: 'bg-emerald-500',
};

const STAGE_LABELS = {
  sql: 'SQL',
  demoScheduled: 'Demo Scheduled',
  demoCompleted: 'Demo Completed',
  closedWon: 'Closed Won',
};

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

export function WeeklyPipelineChart({ ownerId }: WeeklyPipelineChartProps) {
  const [data, setData] = useState<WeeklyPipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<keyof typeof STAGE_COLORS | 'all'>('all');

  // Quarter selection state
  const quarterOptions = getQuarterOptions();
  const [selectedQuarter, setSelectedQuarter] = useState(quarterOptions[0]);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/ae/${ownerId}/weekly-pipeline?year=${selectedQuarter.year}&quarter=${selectedQuarter.quarter}`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch weekly pipeline data');
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
        <div className="text-red-500">Failed to load weekly pipeline data</div>
      </div>
    );
  }

  // Calculate max value for chart scaling
  const getMaxValue = () => {
    if (selectedStage === 'all') {
      return Math.max(
        ...data.weeks.map((w) => Math.max(w.sql, w.demoScheduled, w.demoCompleted, w.closedWon)),
        1
      );
    }
    return Math.max(...data.weeks.map((w) => w[selectedStage]), 1);
  };

  const maxValue = getMaxValue();

  // Get current week number
  const today = new Date();
  const currentWeek = data.weeks.find((w) => {
    const start = new Date(w.weekStart);
    const end = new Date(w.weekEnd);
    return today >= start && today <= end;
  })?.weekNumber;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Weekly Pipeline Activity</h3>
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
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedStage('all')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition ${
              selectedStage === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Stages
          </button>
          {(Object.keys(STAGE_COLORS) as Array<keyof typeof STAGE_COLORS>).map((stage) => (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition ${
                selectedStage === stage
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {STAGE_LABELS[stage]}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      {selectedStage === 'all' && (
        <div className="flex gap-4 mb-4">
          {(Object.entries(STAGE_LABELS) as Array<[keyof typeof STAGE_COLORS, string]>).map(
            ([key, label]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded ${STAGE_COLORS[key]}`} />
                <span className="text-xs text-gray-600">{label}</span>
              </div>
            )
          )}
        </div>
      )}

      {/* Chart */}
      <div className="flex items-end gap-1 h-48">
        {data.weeks.map((week) => {
          const isCurrentWeek = week.weekNumber === currentWeek;
          const isFutureWeek = new Date(week.weekStart) > today;

          return (
            <div
              key={week.weekNumber}
              className={`flex-1 flex flex-col items-center gap-1 ${
                isFutureWeek ? 'opacity-40' : ''
              }`}
            >
              {/* Bars */}
              <div className="w-full flex items-end justify-center gap-0.5 h-40">
                {selectedStage === 'all' ? (
                  <>
                    <Bar value={week.sql} maxValue={maxValue} color={STAGE_COLORS.sql} />
                    <Bar
                      value={week.demoScheduled}
                      maxValue={maxValue}
                      color={STAGE_COLORS.demoScheduled}
                    />
                    <Bar
                      value={week.demoCompleted}
                      maxValue={maxValue}
                      color={STAGE_COLORS.demoCompleted}
                    />
                    <Bar value={week.closedWon} maxValue={maxValue} color={STAGE_COLORS.closedWon} />
                  </>
                ) : (
                  <Bar
                    value={week[selectedStage]}
                    maxValue={maxValue}
                    color={STAGE_COLORS[selectedStage]}
                    wide
                  />
                )}
              </div>

              {/* Week label */}
              <div
                className={`text-xs font-medium ${
                  isCurrentWeek ? 'text-blue-600' : 'text-gray-500'
                }`}
              >
                W{week.weekNumber}
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="grid grid-cols-4 gap-4">
          <TotalCard
            label="Total SQL"
            value={data.totals.sql}
            color="text-blue-600"
            selected={selectedStage === 'sql'}
          />
          <TotalCard
            label="Total Demo Scheduled"
            value={data.totals.demoScheduled}
            color="text-yellow-600"
            selected={selectedStage === 'demoScheduled'}
          />
          <TotalCard
            label="Total Demo Completed"
            value={data.totals.demoCompleted}
            color="text-purple-600"
            selected={selectedStage === 'demoCompleted'}
          />
          <TotalCard
            label="Total Closed Won"
            value={data.totals.closedWon}
            color="text-emerald-600"
            subtitle={formatCurrency(data.totals.closedWonAmount)}
            selected={selectedStage === 'closedWon'}
          />
        </div>
      </div>
    </div>
  );
}

function Bar({
  value,
  maxValue,
  color,
  wide = false,
}: {
  value: number;
  maxValue: number;
  color: string;
  wide?: boolean;
}) {
  const height = value > 0 ? Math.max((value / maxValue) * 100, 4) : 0;

  return (
    <div
      className={`${wide ? 'w-full' : 'w-1.5'} rounded-t transition-all ${color} relative group`}
      style={{ height: `${height}%` }}
    >
      {value > 0 && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
          {value}
        </div>
      )}
    </div>
  );
}

function TotalCard({
  label,
  value,
  color,
  subtitle,
  selected,
}: {
  label: string;
  value: number;
  color: string;
  subtitle?: string;
  selected?: boolean;
}) {
  return (
    <div
      className={`text-center p-2 rounded-lg transition ${selected ? 'bg-gray-50' : ''}`}
    >
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}
    </div>
  );
}
