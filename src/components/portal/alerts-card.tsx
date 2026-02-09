interface AlertDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string | null;
  risk: {
    level: string;
    factors: Array<{ type: string; message: string }>;
  };
  hubspotUrl: string;
}

interface AlertsCardProps {
  deals: AlertDeal[];
  totalAlerts: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getRiskTag(factor: { type: string; message: string }): {
  label: string;
  className: string;
} {
  switch (factor.type) {
    case 'overdue_next_step':
      return { label: 'Next step overdue', className: 'bg-amber-100 text-amber-700' };
    case 'overdue':
      return { label: 'Close date passed', className: 'bg-red-100 text-red-700' };
    case 'activity_drought':
      return { label: 'No recent activity', className: 'bg-slate-100 text-slate-600' };
    case 'no_next_step':
      return { label: 'No next step', className: 'bg-amber-100 text-amber-700' };
    case 'stage_age':
      return { label: 'Stale in stage', className: 'bg-red-100 text-red-700' };
    default:
      return { label: 'Needs attention', className: 'bg-slate-100 text-slate-600' };
  }
}

export function AlertsCard({ deals, totalAlerts }: AlertsCardProps) {
  const displayDeals = deals.slice(0, 5);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Attention Needed
        </p>
        {totalAlerts > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
            {totalAlerts}
          </span>
        )}
      </div>

      {displayDeals.length === 0 ? (
        <div className="flex items-center gap-3 py-8 justify-center text-slate-400">
          <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium text-slate-500">You&apos;re all caught up</span>
        </div>
      ) : (
        <div className="space-y-3">
          {displayDeals.map((deal) => {
            const primaryFactor = deal.risk.factors[0];
            const tag = primaryFactor ? getRiskTag(primaryFactor) : null;

            return (
              <a
                key={deal.id}
                href={deal.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {deal.dealName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {deal.amount != null && (
                      <span className="text-xs text-slate-500">
                        {formatCurrency(deal.amount)}
                      </span>
                    )}
                    {tag && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tag.className}`}>
                        {tag.label}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            );
          })}

          {totalAlerts > 5 && (
            <p className="text-xs text-slate-400 text-center pt-2">
              +{totalAlerts - 5} more deal{totalAlerts - 5 !== 1 ? 's' : ''} need attention
            </p>
          )}
        </div>
      )}
    </div>
  );
}
