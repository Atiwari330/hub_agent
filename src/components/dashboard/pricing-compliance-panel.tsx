'use client';

import { useEffect } from 'react';
import type { PricingResult } from './pricing-compliance-dashboard';

interface PricingCompliancePanelProps {
  result: PricingResult;
  onClose: () => void;
  onReanalyze: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  COMPLIANT: 'bg-green-100 text-green-800 border-green-200',
  EXEMPT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PENDING: 'bg-blue-100 text-blue-800 border-blue-200',
  NON_COMPLIANT: 'bg-red-100 text-red-800 border-red-200',
  STALE_STAGE: 'bg-orange-100 text-orange-800 border-orange-200',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLIANT: 'Compliant',
  EXEMPT: 'Exempt',
  PENDING: 'Pending',
  NON_COMPLIANT: 'Non-Compliant',
  STALE_STAGE: 'Stale Stage',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-green-700 bg-green-100',
  MEDIUM: 'text-amber-700 bg-amber-100',
  HIGH: 'text-red-700 bg-red-100',
};

function formatCurrency(amount: number | null): string {
  if (amount === null) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PricingCompliancePanel({ result, onClose, onReanalyze }: PricingCompliancePanelProps) {
  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const status = result.compliance_status;
  const badgeClass = STATUS_BADGE[status] || 'bg-gray-100 text-gray-600 border-gray-200';
  const statusLabel = STATUS_LABELS[status] || status;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900 truncate">{result.deal_name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${badgeClass}`}>
                {statusLabel}
              </span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${RISK_COLORS[result.risk_level] || RISK_COLORS.MEDIUM}`}>
                {result.risk_level} Risk
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Executive Summary */}
          <Section title="Executive Summary">
            <p className="text-sm text-gray-700 leading-relaxed">{result.executive_summary}</p>
          </Section>

          {/* Key Metrics */}
          <Section title="Details">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="AE" value={result.owner_name} />
              <MetricCard label="Amount" value={formatCurrency(result.amount)} />
              <MetricCard label="Demo Date" value={formatDate(result.demo_completed_at)} />
              <MetricCard label="Demo Detected Via" value={result.demo_detected_via === 'stage_move' ? 'Stage Move' : 'Meeting'} />
              {result.hours_to_pricing !== null && (
                <MetricCard
                  label="Hours to Pricing"
                  value={`${result.hours_to_pricing.toFixed(1)}h`}
                  highlight={result.hours_to_pricing <= 24 ? 'green' : 'red'}
                />
              )}
              <MetricCard label="Stage" value={result.stage_name} />
            </div>
          </Section>

          {/* Pricing Evidence */}
          {result.pricing_evidence && (
            <Section title="Pricing Evidence">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">{result.pricing_evidence}</p>
                {result.pricing_sent_at && (
                  <p className="text-xs text-green-600 mt-1">
                    Sent: {formatDate(result.pricing_sent_at)}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Exemption Reason */}
          {result.exemption_reason && (
            <Section title="Exemption Reason">
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">{result.exemption_reason}</p>
                {result.exemption_noted_at && (
                  <p className="text-xs text-yellow-600 mt-1">
                    Noted: {formatDate(result.exemption_noted_at)}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Analysis Rationale */}
          <Section title="Analysis Rationale">
            <p className="text-sm text-gray-600 leading-relaxed">{result.analysis_rationale}</p>
          </Section>

          {/* Metadata */}
          <Section title="Metadata">
            <div className="text-xs text-gray-400 space-y-1">
              <p>Analyzed: {formatDate(result.analyzed_at)}</p>
              <p>Deal ID: {result.deal_id}</p>
            </div>
          </Section>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <a
              href={`https://app.hubspot.com/contacts/22791011/deal/${result.deal_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View in HubSpot
            </a>
            <button
              onClick={onReanalyze}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-analyze
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'green' | 'red';
}) {
  const valueColor =
    highlight === 'green'
      ? 'text-green-700'
      : highlight === 'red'
      ? 'text-red-700'
      : 'text-gray-900';

  return (
    <div className="p-2.5 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${valueColor} mt-0.5`}>{value}</p>
    </div>
  );
}
