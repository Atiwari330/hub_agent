'use client';

import { useState } from 'react';

interface ScrubResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  closeDate: string | null;
  dealAgeDays: number;
  daysInCurrentStage: number | null;
  daysUntilClose: number | null;
  ownerName: string;
  activityLevel: string;
  customerEngagement: string;
  aeEffort: string;
  dealMomentum: string;
  recommendation: string;
  recommendationRationale: string;
  executiveSummary: string;
  error?: string;
}

interface BriefingSection {
  id: string;
  section_type: string;
  owner_email: string | null;
  status: string;
  results_json: unknown[] | null;
  summary_json: Record<string, unknown> | null;
  item_count: number | null;
  duration_ms: number | null;
  error: string | null;
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not set';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

const RECOMMENDATION_COLORS: Record<string, string> = {
  CLOSE_OUT: 'bg-red-100 text-red-800 ring-red-200',
  ESCALATE: 'bg-orange-100 text-orange-800 ring-orange-200',
  CHANGE_APPROACH: 'bg-amber-100 text-amber-800 ring-amber-200',
  MOVE_TO_NURTURE: 'bg-blue-100 text-blue-800 ring-blue-200',
  KEEP_WORKING: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  CLOSE_OUT: 'Close Out',
  ESCALATE: 'Escalate',
  CHANGE_APPROACH: 'Change Approach',
  MOVE_TO_NURTURE: 'Move to Nurture',
  KEEP_WORKING: 'Keep Working',
  UNKNOWN: 'Unknown',
};

const HEALTH_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500',
  ENGAGED: 'bg-emerald-500',
  STRONG: 'bg-emerald-500',
  ADVANCING: 'bg-emerald-500',
  SLOWING: 'bg-amber-500',
  LUKEWARM: 'bg-amber-500',
  ADEQUATE: 'bg-amber-500',
  FLAT: 'bg-amber-500',
  STALE: 'bg-orange-500',
  UNRESPONSIVE: 'bg-orange-500',
  WEAK: 'bg-orange-500',
  DECLINING: 'bg-orange-500',
  DEAD: 'bg-red-500',
  NO_CONTACT: 'bg-red-500',
  ABSENT: 'bg-red-500',
  UNKNOWN: 'bg-gray-400',
};

const RECOMMENDATION_ORDER = ['CLOSE_OUT', 'ESCALATE', 'CHANGE_APPROACH', 'MOVE_TO_NURTURE', 'KEEP_WORKING', 'UNKNOWN'];

function HealthDot({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${value}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_COLORS[value] || HEALTH_COLORS.UNKNOWN}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function DealCard({ result }: { result: ScrubResult }) {
  if (result.error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <div className="font-medium text-red-900">{result.dealName}</div>
        <div className="text-sm text-red-700 mt-1">Error: {result.error}</div>
      </div>
    );
  }

  const closeDateStr = result.closeDate?.split('T')[0] || 'Not set';
  const closeDateStatus = result.daysUntilClose !== null
    ? result.daysUntilClose < 0
      ? `${Math.abs(result.daysUntilClose)}d past due`
      : `in ${result.daysUntilClose}d`
    : '';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="font-semibold text-gray-900">{result.dealName}</h4>
          <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(result.amount)}</p>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ring-1 whitespace-nowrap ${RECOMMENDATION_COLORS[result.recommendation] || RECOMMENDATION_COLORS.UNKNOWN}`}>
          {RECOMMENDATION_LABELS[result.recommendation] || result.recommendation}
        </span>
      </div>

      {/* Stage and dates */}
      <div className="text-sm text-gray-600 mb-3">
        <span className="font-medium">{result.stageName}</span>
        {result.daysInCurrentStage !== null && (
          <span className="text-gray-400"> ({result.daysInCurrentStage}d in stage)</span>
        )}
        <span className="mx-2 text-gray-300">|</span>
        Age: {result.dealAgeDays}d
        <span className="mx-2 text-gray-300">|</span>
        Close: {closeDateStr} {closeDateStatus && (
          <span className={result.daysUntilClose !== null && result.daysUntilClose < 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
            ({closeDateStatus})
          </span>
        )}
      </div>

      {/* Health indicators */}
      <div className="flex flex-wrap gap-4 mb-3">
        <HealthDot label="Activity" value={result.activityLevel} />
        <HealthDot label="Engagement" value={result.customerEngagement} />
        <HealthDot label="AE Effort" value={result.aeEffort} />
        <HealthDot label="Momentum" value={result.dealMomentum} />
      </div>

      {/* Executive summary */}
      <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 border-l-3 border-gray-300">
        {result.executiveSummary}
      </div>

      {/* Recommendation rationale */}
      {result.recommendationRationale && (
        <p className="text-sm text-gray-500 mt-2 italic">
          {result.recommendationRationale}
        </p>
      )}
    </div>
  );
}

function AeAccordion({
  section,
  defaultOpen,
}: {
  section: BriefingSection;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const results = (section.results_json || []) as ScrubResult[];
  const summary = section.summary_json as {
    totalDeals?: number;
    totalValue?: number;
    atRiskValue?: number;
    byRecommendation?: Record<string, { count: number; value: number }>;
  } | null;

  // Get owner display name from first result or email
  const ownerName = results[0]?.ownerName || section.owner_email || 'Unknown AE';

  // Sort by recommendation priority
  const sorted = [...results].sort((a, b) => {
    const aIdx = RECOMMENDATION_ORDER.indexOf(a.recommendation);
    const bIdx = RECOMMENDATION_ORDER.indexOf(b.recommendation);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (b.amount || 0) - (a.amount || 0);
  });

  if (section.status === 'failed') {
    return (
      <div className="bg-red-50 rounded-xl border border-red-200 p-5">
        <h3 className="font-semibold text-red-900">{ownerName}</h3>
        <p className="text-sm text-red-700 mt-1">Analysis failed: {section.error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 bg-white hover:bg-gray-50 flex items-center justify-between transition-colors"
      >
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-gray-900">{ownerName}</h3>
          <span className="text-sm text-gray-500">
            {summary?.totalDeals || results.length} deals
          </span>
          {summary?.totalValue && (
            <span className="text-sm text-gray-500">
              {formatCurrency(summary.totalValue)}
            </span>
          )}
          {summary?.atRiskValue && summary.atRiskValue > 0 && (
            <span className="text-sm text-red-600 font-medium">
              {formatCurrency(summary.atRiskValue)} at risk
            </span>
          )}
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4 bg-gray-50/50">
          {/* Recommendation breakdown mini-bar */}
          {summary?.byRecommendation && (
            <div className="flex gap-2 flex-wrap">
              {RECOMMENDATION_ORDER.filter((r) => summary.byRecommendation?.[r]).map((rec) => {
                const data = summary.byRecommendation![rec];
                return (
                  <span
                    key={rec}
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ${RECOMMENDATION_COLORS[rec]}`}
                  >
                    {data.count} {RECOMMENDATION_LABELS[rec]}
                  </span>
                );
              })}
            </div>
          )}

          {sorted.map((result) => (
            <DealCard key={result.dealId} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DealScrubSection({ sections }: { sections: BriefingSection[] }) {
  if (sections.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No deal scrub data available for this briefing.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section, i) => (
        <AeAccordion
          key={section.id}
          section={section}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  );
}
