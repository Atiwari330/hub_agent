'use client';

interface WeeklyTrendProps {
  weekDaily: number[];
  dailyGoal: number;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function WeeklyTrend({ weekDaily, dailyGoal }: WeeklyTrendProps) {
  // weekDaily has 5 entries for the last 5 business days
  const maxVal = Math.max(...weekDaily, dailyGoal, 1);

  // Determine which day is "today" (the last entry)
  const todayIndex = weekDaily.length - 1;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-4">
        This Week&apos;s Calls
      </p>
      <div className="flex items-end gap-3 h-32">
        {weekDaily.map((calls, idx) => {
          const heightPercent = (calls / maxVal) * 100;
          const isToday = idx === todayIndex;
          const meetsGoal = calls >= dailyGoal;

          return (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1.5">
              {/* Count label */}
              <span className="text-xs tabular-nums font-medium text-slate-500">
                {calls}
              </span>
              {/* Bar */}
              <div className="w-full flex items-end" style={{ height: '80px' }}>
                <div
                  className={`w-full rounded-t-md transition-all duration-700 ease-out ${
                    meetsGoal ? 'bg-emerald-400' : 'bg-amber-400'
                  } ${isToday ? 'ring-2 ring-offset-1 ring-slate-800' : ''}`}
                  style={{ height: `${Math.max(heightPercent, 4)}%` }}
                />
              </div>
              {/* Day label */}
              <span
                className={`text-xs ${
                  isToday ? 'font-semibold text-slate-900' : 'text-slate-400'
                }`}
              >
                {DAY_LABELS[idx] || `D${idx + 1}`}
              </span>
            </div>
          );
        })}
      </div>
      {/* Goal line indicator */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <div className="w-3 h-0.5 bg-emerald-400 rounded" />
        <span className="text-xs text-slate-400">
          {dailyGoal}+ = on pace
        </span>
        <div className="w-3 h-0.5 bg-amber-400 rounded ml-2" />
        <span className="text-xs text-slate-400">
          Below {dailyGoal}
        </span>
      </div>
    </div>
  );
}
