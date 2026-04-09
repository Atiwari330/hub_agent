'use client';

import { useState } from 'react';
import type { DealForecastItem } from '@/lib/command-center/types';
import { mapInternalToAETier } from '@/lib/deal-review/config';
import { LikelihoodSelector } from './likelihood-selector';
import { OverrideForm } from './override-form';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
};

const SENTIMENT_LABELS: Record<string, { label: string; color: string }> = {
  positive: { label: 'Positive', color: 'text-emerald-600' },
  engaged: { label: 'Engaged', color: 'text-blue-600' },
  neutral: { label: 'Neutral', color: 'text-gray-600' },
  unresponsive: { label: 'Unresponsive', color: 'text-orange-600' },
  negative: { label: 'Negative', color: 'text-red-600' },
};

const MOMENTUM_LABELS: Record<string, { label: string; color: string }> = {
  accelerating: { label: 'Accelerating', color: 'text-emerald-600' },
  steady: { label: 'Steady', color: 'text-blue-600' },
  slowing: { label: 'Slowing', color: 'text-amber-600' },
  stalled: { label: 'Stalled', color: 'text-red-600' },
};

const AI_TIER_LABELS: Record<string, string> = {
  highly_likely: 'Highly Likely',
  likely: 'Likely',
  possible: 'Possible',
  unlikely: 'Unlikely',
  insufficient_data: 'No Data',
};

interface DealReviewCardProps {
  deal: DealForecastItem;
  onOverrideChange: () => void;
}

export function DealReviewCard({ deal, onOverrideChange }: DealReviewCardProps) {
  const [pendingAEValue, setPendingAEValue] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasOverride = !!deal.override;
  const effectiveTier = hasOverride ? deal.override!.likelihood : deal.likelihoodTier;
  const currentAEValue = mapInternalToAETier(effectiveTier);

  function handleSelect(aeValue: string) {
    if (aeValue === currentAEValue && hasOverride) return;
    setPendingAEValue(aeValue);
  }

  async function handleReset() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/deal-review/${deal.hubspotDealId}/override`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPendingAEValue(null);
        onOverrideChange();
      }
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved() {
    setPendingAEValue(null);
    onOverrideChange();
  }

  const closeDate = deal.closeDate
    ? new Date(deal.closeDate + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'No date';

  const sentiment = deal.buyerSentiment ? SENTIMENT_LABELS[deal.buyerSentiment] : null;
  const momentum = deal.dealMomentum ? MOMENTUM_LABELS[deal.dealMomentum] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 truncate">{deal.dealName}</h3>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span className="font-mono font-medium text-gray-900">{fmt(deal.amount)}</span>
              <span>{deal.stage}</span>
              <span>Close: {closeDate}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${GRADE_COLORS[deal.overallGrade] || 'bg-gray-100'}`}
            >
              {deal.overallGrade}
            </span>
            <span className="text-xs text-gray-400">
              AI: {AI_TIER_LABELS[deal.likelihoodTier] || deal.likelihoodTier}
            </span>
          </div>
        </div>
      </div>

      {/* AI Summary */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <div className="space-y-2">
          {/* Sentiment + Momentum tags */}
          {(sentiment || momentum) && (
            <div className="flex items-center gap-3 text-xs">
              {sentiment && (
                <span className={sentiment.color}>
                  Buyer: {sentiment.label}
                </span>
              )}
              {momentum && (
                <span className={momentum.color}>
                  Momentum: {momentum.label}
                </span>
              )}
            </div>
          )}

          {/* Key risk */}
          {deal.keyRisk && (
            <p className="text-sm text-gray-700">
              <span className="font-medium text-red-600">Risk:</span> {deal.keyRisk}
            </p>
          )}

          {/* Recommended action */}
          {deal.recommendedAction && (
            <p className="text-sm text-gray-700">
              <span className="font-medium text-indigo-600">Next:</span> {deal.recommendedAction}
            </p>
          )}

          {/* Reasoning (collapsible) */}
          {deal.reasoning && (
            <details className="text-sm">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                Full AI reasoning
              </summary>
              <p className="mt-1 text-gray-600 whitespace-pre-line">{deal.reasoning}</p>
            </details>
          )}

          {/* Fallback when no AI data */}
          {!deal.keyRisk && !deal.recommendedAction && !deal.reasoning && (
            <p className="text-sm text-gray-400 italic">No AI analysis available yet</p>
          )}
        </div>
      </div>

      {/* Likelihood selector */}
      <div className="px-5 py-4">
        <LikelihoodSelector
          selectedValue={pendingAEValue ?? currentAEValue}
          isOverride={hasOverride}
          onSelect={handleSelect}
          onReset={handleReset}
          disabled={deleting}
        />

        {/* Override reason */}
        {hasOverride && !pendingAEValue && deal.override?.reason && (
          <p className="mt-2 text-xs text-gray-500 italic">
            &ldquo;{deal.override.reason}&rdquo;
          </p>
        )}

        {/* Override form (shown when selecting a new value) */}
        {pendingAEValue && pendingAEValue !== currentAEValue && (
          <OverrideForm
            dealId={deal.hubspotDealId}
            aeValue={pendingAEValue}
            onSaved={handleSaved}
            onCancel={() => setPendingAEValue(null)}
          />
        )}
      </div>
    </div>
  );
}
