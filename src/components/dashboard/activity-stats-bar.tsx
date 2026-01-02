import { formatCurrency, formatPercent } from '@/lib/utils/currency';

interface ActivityStatsBarProps {
  avgDealSize: number;
  avgSalesCycle: number | null;
  winRate: number;
  totalDeals: number;
  closedWonCount: number;
  closedLostCount: number;
}

export function ActivityStatsBar({
  avgDealSize,
  avgSalesCycle,
  winRate,
  totalDeals,
  closedWonCount,
  closedLostCount,
}: ActivityStatsBarProps) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 mb-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-0 md:divide-x md:divide-slate-200">
        {/* Avg Deal Size */}
        <div className="text-center px-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Avg Deal Size
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {formatCurrency(avgDealSize)}
          </div>
        </div>

        {/* Avg Sales Cycle */}
        <div className="text-center px-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Avg Sales Cycle
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {avgSalesCycle !== null ? `${avgSalesCycle} days` : 'N/A'}
          </div>
        </div>

        {/* Win Rate */}
        <div className="text-center px-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Win Rate
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {formatPercent(winRate)}
          </div>
        </div>

        {/* Total Deals */}
        <div className="text-center px-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Total Deals
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {totalDeals}
          </div>
        </div>

        {/* Won/Lost */}
        <div className="text-center px-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Won / Lost
          </div>
          <div className="text-lg font-semibold text-slate-900">
            <span className="text-emerald-600">{closedWonCount}</span>
            {' / '}
            <span className="text-red-600">{closedLostCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
