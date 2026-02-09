interface RevenueCardProps {
  quota: {
    target: number;
    closedWon: number;
    attainment: number;
    pace: number;
    onTrack: boolean;
  };
  pipeline: {
    totalValue: number;
    dealCount: number;
    coverageRatio: number;
  };
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatCurrencyFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function RevenueCard({ quota, pipeline }: RevenueCardProps) {
  const progressPercent = Math.min(quota.attainment, 100);
  const progressColor = quota.onTrack ? 'bg-emerald-500' : quota.attainment >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const paceColor = quota.onTrack ? 'text-emerald-600' : 'text-red-600';
  const paceArrow = quota.onTrack ? '\u2191' : '\u2193';
  const coverageColor =
    pipeline.coverageRatio >= 3 ? 'text-emerald-600' : pipeline.coverageRatio >= 2 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-4">
        Revenue Snapshot
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Quota Attainment */}
        <div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-4xl font-bold tabular-nums text-slate-900">
              {Math.round(quota.attainment)}%
            </span>
            <span className="text-sm text-slate-500">attainment</span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out ${progressColor}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="text-sm text-slate-500 mb-1">
            {formatCurrencyFull(quota.closedWon)} of {formatCurrencyFull(quota.target)}
          </p>

          {quota.target > 0 && (
            <p className={`text-sm font-medium ${paceColor}`}>
              {paceArrow} {formatCurrency(Math.abs(quota.pace))} {quota.onTrack ? 'ahead' : 'behind'} pace
            </p>
          )}
        </div>

        {/* Pipeline */}
        <div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-4xl font-bold tabular-nums text-slate-900">
              {formatCurrency(pipeline.totalValue)}
            </span>
            <span className="text-sm text-slate-500">pipeline</span>
          </div>

          <p className="text-sm text-slate-500 mb-1">
            {pipeline.dealCount} active deal{pipeline.dealCount !== 1 ? 's' : ''}
          </p>

          <p className={`text-sm font-medium ${coverageColor}`}>
            {pipeline.coverageRatio}x coverage
          </p>
        </div>
      </div>
    </div>
  );
}
