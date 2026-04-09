'use client';

interface Insight {
  category: 'forecast' | 'pacing' | 'initiatives' | 'deals' | 'execution';
  status: 'on_track' | 'watch' | 'action_needed';
  title: string;
  detail: string;
}

interface ExecutiveSummaryProps {
  insights: Insight[];
}

const STATUS_CONFIG = {
  action_needed: {
    icon: '!',
    bg: 'bg-red-50 border-red-200',
    iconBg: 'bg-red-100 text-red-700',
    title: 'text-red-900',
    detail: 'text-red-700',
  },
  watch: {
    icon: '~',
    bg: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100 text-amber-700',
    title: 'text-amber-900',
    detail: 'text-amber-700',
  },
  on_track: {
    icon: '\u2713',
    bg: 'bg-emerald-50 border-emerald-200',
    iconBg: 'bg-emerald-100 text-emerald-700',
    title: 'text-emerald-900',
    detail: 'text-emerald-700',
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  forecast: 'Forecast',
  pacing: 'Pacing',
  initiatives: 'Initiatives',
  deals: 'Deals',
  execution: 'AE Execution',
};

export function ExecutiveSummary({ insights }: ExecutiveSummaryProps) {
  if (insights.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Key Insights</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {insights.slice(0, 8).map((insight, i) => {
          const config = STATUS_CONFIG[insight.status];
          return (
            <div key={i} className={`rounded-lg border p-4 ${config.bg}`}>
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${config.iconBg}`}>
                  {config.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                      {CATEGORY_LABELS[insight.category] || insight.category}
                    </span>
                  </div>
                  <p className={`text-sm font-semibold mt-0.5 ${config.title}`}>{insight.title}</p>
                  <p className={`text-xs mt-1 ${config.detail}`}>{insight.detail}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
