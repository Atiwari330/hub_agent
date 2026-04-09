'use client';

import { useState, useEffect } from 'react';

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

const LIKELIHOOD_COLORS: Record<string, string> = {
  highly_likely: 'bg-emerald-100 text-emerald-800',
  likely: 'bg-blue-100 text-blue-800',
  possible: 'bg-amber-100 text-amber-800',
  unlikely: 'bg-red-100 text-red-800',
  insufficient_data: 'bg-gray-100 text-gray-600',
};

const LIKELIHOOD_LABELS: Record<string, string> = {
  highly_likely: 'Highly Likely',
  likely: 'Likely',
  possible: 'Possible',
  unlikely: 'Unlikely',
  insufficient_data: 'No Data',
};

interface TimelineEntry {
  stage: string;
  label: string;
  enteredAt: string | null;
}

interface DealDetailData {
  deal: {
    hubspotDealId: string;
    dealName: string;
    ownerName: string;
    amount: number;
    stage: string;
    closeDate: string | null;
    leadSource: string | null;
    overallGrade: string;
    overallScore: number;
    likelihoodTier: string;
    llmStatus: string | null;
    buyerSentiment: string | null;
    dealMomentum: string | null;
    keyRisk: string | null;
    recommendedAction: string | null;
    reasoning: string | null;
  };
  timeline: TimelineEntry[];
  intelligence: {
    hygieneScore: number;
    momentumScore: number;
    engagementScore: number;
    riskScore: number;
    issues: { type: string; severity: string; message: string }[];
    missingFields: string[];
    llmReasoning: string | null;
    recommendedAction: string | null;
    coaching: {
      situation: string | null;
      nextAction: string | null;
      followUp: string | null;
    } | null;
  };
  override: {
    likelihood: string;
    amount: number | null;
    reason: string;
    overriddenBy: string;
    overriddenAt: string;
  } | null;
}

interface DealDetailPanelProps {
  dealId: string;
  onClose: () => void;
}

export function DealDetailPanel({ dealId, onClose }: DealDetailPanelProps) {
  const [data, setData] = useState<DealDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/command-center/deals/${dealId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto border-l border-gray-200">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 truncate pr-4">
            {data?.deal.dealName || 'Deal Detail'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>

        {loading && (
          <div className="p-6 space-y-4 animate-pulse">
            <div className="h-20 rounded bg-gray-200" />
            <div className="h-32 rounded bg-gray-200" />
            <div className="h-48 rounded bg-gray-200" />
          </div>
        )}

        {error && (
          <div className="p-6">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Failed to load deal detail: {error}
            </div>
          </div>
        )}

        {data && (
          <div className="p-6 space-y-6">
            {/* Deal summary */}
            <DealSummary deal={data.deal} />

            {/* Intelligence dimensions */}
            <IntelligenceBars intel={data.intelligence} />

            {/* Stage timeline */}
            <StageTimeline timeline={data.timeline} currentStage={data.deal.stage} />

            {/* AI assessment */}
            <AIAssessment deal={data.deal} intel={data.intelligence} />

            {/* Coaching */}
            {data.intelligence.coaching && <CoachingSection coaching={data.intelligence.coaching} />}

            {/* Issues */}
            {data.intelligence.issues.length > 0 && <IssuesList issues={data.intelligence.issues} />}

            {/* Override */}
            <OverrideSection override={data.override} />
          </div>
        )}
      </div>
    </>
  );
}

function DealSummary({ deal }: { deal: DealDetailData['deal'] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`rounded px-2.5 py-1 text-sm font-bold ${GRADE_COLORS[deal.overallGrade] || 'bg-gray-100'}`}>
          {deal.overallGrade}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${LIKELIHOOD_COLORS[deal.likelihoodTier] || 'bg-gray-100'}`}>
          {LIKELIHOOD_LABELS[deal.likelihoodTier] || deal.likelihoodTier}
        </span>
        <span className="text-sm text-gray-500">Score: {deal.overallScore}/100</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-gray-500">Owner:</span> <span className="text-gray-900">{deal.ownerName}</span></div>
        <div><span className="text-gray-500">Amount:</span> <span className="font-mono text-gray-900">{fmt(deal.amount)}</span></div>
        <div><span className="text-gray-500">Stage:</span> <span className="text-gray-900">{deal.stage}</span></div>
        <div><span className="text-gray-500">Close Date:</span> <span className="text-gray-900">{deal.closeDate || '–'}</span></div>
        <div><span className="text-gray-500">Lead Source:</span> <span className="text-gray-900">{deal.leadSource || '–'}</span></div>
      </div>
    </div>
  );
}

function IntelligenceBars({ intel }: { intel: DealDetailData['intelligence'] }) {
  const dims = [
    { label: 'Hygiene', score: intel.hygieneScore, weight: '15%' },
    { label: 'Momentum', score: intel.momentumScore, weight: '30%' },
    { label: 'Engagement', score: intel.engagementScore, weight: '35%' },
    { label: 'Risk', score: intel.riskScore, weight: '20%' },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Intelligence Dimensions</h3>
      <div className="space-y-2.5">
        {dims.map((d) => {
          const color = d.score >= 70 ? 'bg-emerald-500' : d.score >= 40 ? 'bg-amber-500' : 'bg-red-500';
          return (
            <div key={d.label} className="flex items-center gap-3">
              <div className="w-24 text-xs text-gray-600">{d.label} <span className="text-gray-400">({d.weight})</span></div>
              <div className="flex-1 h-2.5 rounded-full bg-gray-100">
                <div className={`h-2.5 rounded-full ${color} transition-all`} style={{ width: `${d.score}%` }} />
              </div>
              <div className="w-8 text-right text-xs font-mono text-gray-700">{d.score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StageTimeline({ timeline, currentStage }: { timeline: TimelineEntry[]; currentStage: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Stage Timeline</h3>
      <div className="space-y-0">
        {timeline.map((entry, i) => {
          const isCurrent = currentStage.toLowerCase().includes(entry.label.toLowerCase().split('/')[0]);
          const hasDate = !!entry.enteredAt;

          // Calculate gap from previous entry
          let gapDays: number | null = null;
          if (entry.enteredAt && i > 0) {
            const prev = timeline.slice(0, i).reverse().find((e) => e.enteredAt);
            if (prev?.enteredAt) {
              gapDays = Math.round((new Date(entry.enteredAt).getTime() - new Date(prev.enteredAt).getTime()) / 86400000);
            }
          }

          return (
            <div key={entry.stage} className="flex items-start gap-3">
              {/* Connector */}
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full border-2 ${
                  isCurrent ? 'border-indigo-500 bg-indigo-500' :
                  hasDate ? 'border-emerald-500 bg-emerald-500' :
                  'border-gray-300 bg-white'
                }`} />
                {i < timeline.length - 1 && (
                  <div className={`w-0.5 h-6 ${hasDate ? 'bg-gray-300' : 'bg-gray-200'}`} />
                )}
              </div>
              {/* Content */}
              <div className="pb-3 -mt-0.5">
                <div className={`text-xs font-medium ${isCurrent ? 'text-indigo-700' : hasDate ? 'text-gray-900' : 'text-gray-400'}`}>
                  {entry.label}
                  {isCurrent && <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded">Current</span>}
                </div>
                {entry.enteredAt && (
                  <div className="text-[11px] text-gray-500">
                    {new Date(entry.enteredAt).toLocaleDateString()}
                    {gapDays !== null && gapDays > 14 && (
                      <span className="ml-1.5 text-amber-600">({gapDays}d from prev)</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AIAssessment({ deal, intel }: { deal: DealDetailData['deal']; intel: DealDetailData['intelligence'] }) {
  if (!deal.llmStatus) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">AI Assessment</h3>
        <p className="text-xs text-gray-400 italic">AI assessment pending — will be available after next analysis run.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">AI Assessment</h3>
      <div className="space-y-2 text-sm">
        {deal.llmStatus && (
          <div><span className="text-gray-500">Status:</span> <span className="text-gray-900 capitalize">{deal.llmStatus.replace(/_/g, ' ')}</span></div>
        )}
        {deal.buyerSentiment && (
          <div><span className="text-gray-500">Buyer Sentiment:</span> <span className="text-gray-900 capitalize">{deal.buyerSentiment}</span></div>
        )}
        {deal.dealMomentum && (
          <div><span className="text-gray-500">Momentum:</span> <span className="text-gray-900 capitalize">{deal.dealMomentum}</span></div>
        )}
        {deal.keyRisk && (
          <div><span className="text-gray-500">Key Risk:</span> <span className="text-gray-900">{deal.keyRisk}</span></div>
        )}
        {intel.recommendedAction && (
          <div className="mt-2 rounded bg-indigo-50 p-3">
            <span className="text-xs font-medium text-indigo-700">Recommended Action</span>
            <p className="text-xs text-indigo-900 mt-1">{intel.recommendedAction}</p>
          </div>
        )}
        {intel.llmReasoning && (
          <details className="mt-2">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Full reasoning</summary>
            <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">{intel.llmReasoning}</p>
          </details>
        )}
      </div>
    </div>
  );
}

function CoachingSection({ coaching }: { coaching: NonNullable<DealDetailData['intelligence']['coaching']> }) {
  if (!coaching.situation && !coaching.nextAction) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Pre-Demo Coaching</h3>
      <div className="space-y-2 text-sm">
        {coaching.situation && (
          <div><span className="text-gray-500">Situation:</span> <p className="text-gray-900 text-xs mt-0.5">{coaching.situation}</p></div>
        )}
        {coaching.nextAction && (
          <div><span className="text-gray-500">Next Action:</span> <p className="text-gray-900 text-xs mt-0.5">{coaching.nextAction}</p></div>
        )}
        {coaching.followUp && (
          <div><span className="text-gray-500">Follow-up:</span> <p className="text-gray-900 text-xs mt-0.5">{coaching.followUp}</p></div>
        )}
      </div>
    </div>
  );
}

function IssuesList({ issues }: { issues: { type: string; severity: string; message: string }[] }) {
  const severityColors: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600',
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Issues ({issues.length})</h3>
      <div className="space-y-1.5">
        {issues.map((issue, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-medium ${severityColors[issue.severity] || severityColors.low}`}>
              {issue.severity}
            </span>
            <span className="text-gray-700">{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverrideSection({ override }: { override: DealDetailData['override'] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Forecast Override</h3>
      {override ? (
        <div className="rounded border border-indigo-200 bg-indigo-50 p-3 text-sm space-y-1">
          <div><span className="text-gray-500">Likelihood:</span> <span className="text-gray-900">{override.likelihood}</span></div>
          {override.amount !== null && (
            <div><span className="text-gray-500">Amount:</span> <span className="font-mono text-gray-900">{fmt(override.amount)}</span></div>
          )}
          <div><span className="text-gray-500">Reason:</span> <span className="text-gray-900">{override.reason}</span></div>
          <div className="text-xs text-gray-400">
            by {override.overriddenBy} on {new Date(override.overriddenAt).toLocaleDateString()}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">No override. Phase 3 will add editing.</p>
      )}
    </div>
  );
}
