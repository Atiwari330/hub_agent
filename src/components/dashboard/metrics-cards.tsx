import { formatCurrency, formatCurrencyWithSign, formatPercent } from '@/lib/utils/currency';

interface MetricsCardsProps {
  quota: {
    amount: number;
    closedWon: number;
    progress: number;
    hasQuota: boolean;
  };
  paceToGoal: {
    expectedByNow: number;
    actual: number;
    pace: number;
    onTrack: boolean;
  };
  pipeline: {
    totalValue: number;
    dealCount: number;
  };
  quarterProgress: number;
}

function TrendUpIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function TrendDownIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
    </svg>
  );
}

export function MetricsCards({ quota, paceToGoal, pipeline, quarterProgress }: MetricsCardsProps) {
  // Calculate coverage ratio
  const remainingQuota = quota.amount - quota.closedWon;
  const coverageRatio = remainingQuota > 0 ? pipeline.totalValue / remainingQuota : null;

  // Determine progress bar color
  const getProgressColor = () => {
    if (quota.progress >= quarterProgress) return 'bg-emerald-500';
    if (quota.progress >= quarterProgress - 10) return 'bg-amber-500';
    return 'bg-red-500';
  };

  // Determine coverage health
  const getCoverageHealth = () => {
    if (coverageRatio === null) return { label: 'N/A', color: 'text-gray-500' };
    if (coverageRatio >= 3) return { label: `${coverageRatio.toFixed(1)}x coverage`, color: 'text-emerald-600' };
    if (coverageRatio >= 2) return { label: `${coverageRatio.toFixed(1)}x coverage`, color: 'text-amber-600' };
    return { label: `${coverageRatio.toFixed(1)}x coverage`, color: 'text-red-600' };
  };

  const coverage = getCoverageHealth();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Quota Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-medium text-gray-500 mb-1">Quota Progress</div>
        {quota.hasQuota ? (
          <>
            <div className="text-3xl font-semibold text-gray-900">
              {formatCurrency(quota.closedWon)}
            </div>
            <div className="text-sm text-gray-500 mb-3">
              of {formatCurrency(quota.amount)}
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getProgressColor()}`}
                style={{ width: `${Math.min(100, quota.progress)}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {formatPercent(quota.progress)} attainment
            </div>
          </>
        ) : (
          <>
            <div className="text-3xl font-semibold text-gray-900">
              {formatCurrency(quota.closedWon)}
            </div>
            <div className="text-sm text-amber-600 mt-2">
              No quota set for this quarter
            </div>
          </>
        )}
      </div>

      {/* Pace to Goal */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-medium text-gray-500 mb-1">Pace to Goal</div>
        <div className={`text-3xl font-semibold ${paceToGoal.onTrack ? 'text-emerald-600' : 'text-red-600'}`}>
          {formatCurrencyWithSign(paceToGoal.pace)}
        </div>
        <div className="text-sm text-gray-500 mb-3">
          {paceToGoal.onTrack ? 'ahead of pace' : 'behind pace'}
        </div>
        <div className={`flex items-center gap-1 text-sm ${paceToGoal.onTrack ? 'text-emerald-600' : 'text-red-600'}`}>
          {paceToGoal.onTrack ? <TrendUpIcon /> : <TrendDownIcon />}
          <span>{paceToGoal.onTrack ? 'On track' : 'Needs attention'}</span>
        </div>
      </div>

      {/* Pipeline Value */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-medium text-gray-500 mb-1">Pipeline Value</div>
        <div className="text-3xl font-semibold text-gray-900">
          {formatCurrency(pipeline.totalValue)}
        </div>
        <div className="text-sm text-gray-500 mb-3">
          {pipeline.dealCount} active deal{pipeline.dealCount !== 1 ? 's' : ''}
        </div>
        {quota.hasQuota && (
          <div className={`text-sm font-medium ${coverage.color}`}>
            {coverage.label}
          </div>
        )}
      </div>

      {/* Deal Count */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-sm font-medium text-gray-500 mb-1">Active Deals</div>
        <div className="text-3xl font-semibold text-gray-900">
          {pipeline.dealCount}
        </div>
        <div className="text-sm text-gray-500 mb-3">
          in pipeline
        </div>
        <div className="text-sm text-gray-500">
          Avg: {pipeline.dealCount > 0
            ? formatCurrency(pipeline.totalValue / pipeline.dealCount)
            : '$0'} / deal
        </div>
      </div>
    </div>
  );
}
