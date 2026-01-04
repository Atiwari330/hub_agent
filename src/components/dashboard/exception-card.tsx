'use client';

import { formatCurrency } from '@/lib/utils/currency';

export type ExceptionType =
  | 'overdue_next_step'
  | 'past_close_date'
  | 'activity_drought'
  | 'no_next_step'
  | 'stale_stage'
  | 'high_value_at_risk';

export interface ExceptionDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  exceptionType: ExceptionType;
  exceptionDetail: string;
  daysSinceActivity: number | null;
  daysInStage: number | null;
  nextStepDueDate: string | null;
}

interface ExceptionCardProps {
  deal: ExceptionDeal;
  hubspotPortalId?: string;
}

const EXCEPTION_LABELS: Record<ExceptionType, { label: string; color: string; icon: string }> = {
  overdue_next_step: {
    label: 'Overdue Next Step',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '!',
  },
  past_close_date: {
    label: 'Past Close Date',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '!',
  },
  activity_drought: {
    label: 'No Activity',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '?',
  },
  no_next_step: {
    label: 'No Next Step',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '-',
  },
  stale_stage: {
    label: 'Stuck in Stage',
    color: 'bg-amber-100 text-amber-800 ring-amber-200',
    icon: '~',
  },
  high_value_at_risk: {
    label: 'High Value At Risk',
    color: 'bg-red-100 text-red-800 ring-red-200',
    icon: '$',
  },
};

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function ExceptionCard({ deal, hubspotPortalId = '6187034' }: ExceptionCardProps) {
  const exception = EXCEPTION_LABELS[deal.exceptionType];
  const hubspotUrl = `https://app.hubspot.com/contacts/${hubspotPortalId}/deal/${deal.hubspotDealId}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        {/* Deal info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-900 hover:text-indigo-600 truncate"
            >
              {deal.dealName}
            </a>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ${exception.color}`}>
              {exception.label}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              {deal.amount ? formatCurrency(deal.amount) : '-'}
            </span>
            <span>&bull;</span>
            <span>{deal.stageName}</span>
            <span>&bull;</span>
            <span>Close: {formatDate(deal.closeDate)}</span>
          </div>

          <p className="mt-1 text-xs text-gray-600">{deal.exceptionDetail}</p>
        </div>

        {/* Owner */}
        <div className="flex-shrink-0 text-right">
          <a
            href={`/dashboard/ae/${deal.ownerId}`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {deal.ownerName}
          </a>
        </div>
      </div>
    </div>
  );
}

interface ExceptionListProps {
  deals: ExceptionDeal[];
  title: string;
  emptyMessage?: string;
  hubspotPortalId?: string;
}

export function ExceptionList({ deals, title, emptyMessage = 'No exceptions', hubspotPortalId }: ExceptionListProps) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-3">{title}</h3>
      {deals.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => (
            <ExceptionCard key={deal.id} deal={deal} hubspotPortalId={hubspotPortalId} />
          ))}
        </div>
      )}
    </div>
  );
}
