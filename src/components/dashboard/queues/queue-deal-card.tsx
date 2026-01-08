'use client';

import { formatCurrency } from '@/lib/utils/currency';

interface HygieneQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  status: 'needs_commitment' | 'pending' | 'escalated';
  missingFields: { field: string; label: string }[];
  commitment: { date: string; daysRemaining: number } | null;
  reason: string;
}

interface NextStepQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  status: 'missing' | 'overdue';
  nextStep: string | null;
  daysOverdue: number | null;
  reason: string;
}

interface QueueDealCardProps {
  deal: HygieneQueueDeal | NextStepQueueDeal;
  type: 'hygiene' | 'next-step';
  onSetCommitment?: (dealId: string) => void;
}

function getStatusBadge(status: string, type: 'hygiene' | 'next-step') {
  if (type === 'hygiene') {
    switch (status) {
      case 'needs_commitment':
        return { label: 'Needs Date', color: 'bg-blue-100 text-blue-800' };
      case 'pending':
        return { label: 'Pending', color: 'bg-amber-100 text-amber-800' };
      case 'escalated':
        return { label: 'Escalated', color: 'bg-red-100 text-red-800' };
      default:
        return { label: status, color: 'bg-gray-100 text-gray-800' };
    }
  } else {
    switch (status) {
      case 'missing':
        return { label: 'Missing', color: 'bg-amber-100 text-amber-800' };
      case 'overdue':
        return { label: 'Overdue', color: 'bg-red-100 text-red-800' };
      default:
        return { label: status, color: 'bg-gray-100 text-gray-800' };
    }
  }
}

export function QueueDealCard({ deal, type, onSetCommitment }: QueueDealCardProps) {
  const statusBadge = getStatusBadge(deal.status, type);
  const isHygieneDeal = type === 'hygiene';
  const hygieneDeal = isHygieneDeal ? (deal as HygieneQueueDeal) : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{deal.dealName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{deal.ownerName}</p>
        </div>
        <span
          className={`flex-shrink-0 ml-2 px-2 py-1 text-xs font-medium rounded-full ${statusBadge.color}`}
        >
          {statusBadge.label}
        </span>
      </div>

      {/* Details */}
      <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {deal.amount ? formatCurrency(deal.amount) : 'No amount'}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          {deal.stageName}
        </span>
      </div>

      {/* Reason */}
      <div className="bg-gray-50 rounded-md p-2.5 mb-3">
        <p className="text-xs text-gray-700">{deal.reason}</p>
      </div>

      {/* Missing Fields (for hygiene) */}
      {hygieneDeal && hygieneDeal.missingFields.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1.5">Missing fields:</p>
          <div className="flex flex-wrap gap-1.5">
            {hygieneDeal.missingFields.map((field) => (
              <span
                key={field.field}
                className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
              >
                {field.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Commitment info (for hygiene) */}
      {hygieneDeal?.commitment && (
        <div className="text-xs text-gray-500 mb-3">
          <span className="font-medium">Due date:</span>{' '}
          {new Date(hygieneDeal.commitment.date).toLocaleDateString()}{' '}
          ({hygieneDeal.commitment.daysRemaining > 0
            ? `${hygieneDeal.commitment.daysRemaining} days left`
            : 'Due today'}
          )
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        {isHygieneDeal && deal.status === 'needs_commitment' && onSetCommitment && (
          <button
            onClick={() => onSetCommitment(deal.id)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors"
          >
            Set Date
          </button>
        )}
        {isHygieneDeal && deal.status === 'pending' && onSetCommitment && (
          <button
            onClick={() => onSetCommitment(deal.id)}
            className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors"
          >
            Update Date
          </button>
        )}
      </div>
    </div>
  );
}
