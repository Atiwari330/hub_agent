'use client';

import type { PricingResult } from './pricing-compliance-dashboard';

interface PricingComplianceCardProps {
  result: PricingResult;
  onClick: () => void;
}

const STATUS_BORDER: Record<string, string> = {
  COMPLIANT: 'border-l-green-500',
  EXEMPT: 'border-l-yellow-400',
  PENDING: 'border-l-blue-400',
  NON_COMPLIANT: 'border-l-red-500',
  STALE_STAGE: 'border-l-orange-400',
};

const STATUS_BADGE: Record<string, string> = {
  COMPLIANT: 'bg-green-100 text-green-800',
  EXEMPT: 'bg-yellow-100 text-yellow-800',
  PENDING: 'bg-blue-100 text-blue-800',
  NON_COMPLIANT: 'bg-red-100 text-red-800',
  STALE_STAGE: 'bg-orange-100 text-orange-800',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLIANT: 'Compliant',
  EXEMPT: 'Exempt',
  PENDING: 'Pending',
  NON_COMPLIANT: 'Non-Compliant',
  STALE_STAGE: 'Stale Stage',
};

const RISK_BADGE: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
};

function formatCurrency(amount: number | null): string {
  if (amount === null) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDemoDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatHoursRemaining(demoAt: string): string {
  const deadline = new Date(new Date(demoAt).getTime() + 24 * 60 * 60 * 1000);
  const remaining = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
  if (remaining <= 0) return 'Expired';
  if (remaining < 1) return `${Math.round(remaining * 60)}m remaining`;
  return `${remaining.toFixed(1)}h remaining`;
}

export function PricingComplianceCard({ result, onClick }: PricingComplianceCardProps) {
  const status = result.compliance_status;
  const borderClass = STATUS_BORDER[status] || 'border-l-gray-300';
  const badgeClass = STATUS_BADGE[status] || 'bg-gray-100 text-gray-600';
  const statusLabel = STATUS_LABELS[status] || status;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white border border-gray-200 rounded-xl p-4 border-l-4 ${borderClass} hover:shadow-md transition-shadow`}
    >
      {/* Top row: deal name + status badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{result.deal_name}</h3>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
            <span>{result.owner_name}</span>
            <span className="text-gray-300">|</span>
            <span>{formatCurrency(result.amount)}</span>
            <span className="text-gray-300">|</span>
            <span>{result.stage_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result.risk_level === 'HIGH' && (
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${RISK_BADGE.HIGH}`}>
              High Risk
            </span>
          )}
          <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${badgeClass}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Timing info */}
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
        <span>Demo: {formatDemoDate(result.demo_completed_at)}</span>
        {result.hours_to_pricing !== null && (
          <span className={`font-medium ${result.hours_to_pricing <= 24 ? 'text-green-700' : 'text-red-700'}`}>
            Pricing sent in {result.hours_to_pricing.toFixed(1)}h
          </span>
        )}
        {status === 'PENDING' && (
          <span className="text-blue-600 font-medium">
            {formatHoursRemaining(result.demo_completed_at)}
          </span>
        )}
        {result.demo_detected_via === 'meeting_engagement' && (
          <span className="text-orange-600 font-medium">
            Stage not updated
          </span>
        )}
      </div>

      {/* Executive summary */}
      <p className="text-sm text-gray-700 line-clamp-2">
        {result.executive_summary}
      </p>

      {/* Exemption reason if applicable */}
      {result.exemption_reason && (
        <div className="mt-2 px-2.5 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-xs text-yellow-800">
            <span className="font-semibold">Exemption: </span>
            {result.exemption_reason}
          </p>
        </div>
      )}
    </button>
  );
}
