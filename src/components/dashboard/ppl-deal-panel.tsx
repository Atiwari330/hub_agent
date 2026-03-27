'use client';

import { useEffect, useState } from 'react';
import type { PplResult } from './ppl-dashboard';

interface PplDealPanelProps {
  result: PplResult;
  onClose: () => void;
  onReanalyze: () => void;
}

const COMPLIANCE_COLORS: Record<string, string> = {
  COMPLIANT: 'text-green-700 bg-green-50',
  PARTIAL: 'text-amber-700 bg-amber-50',
  NON_COMPLIANT: 'text-red-700 bg-red-50',
  TOO_EARLY: 'text-gray-600 bg-gray-50',
  UNKNOWN: 'text-gray-500 bg-gray-50',
};

const VERDICT_BADGE: Record<string, string> = {
  EXEMPLARY: 'bg-green-100 text-green-800',
  COMPLIANT: 'bg-emerald-100 text-emerald-800',
  NEEDS_IMPROVEMENT: 'bg-orange-100 text-orange-800',
  NON_COMPLIANT: 'bg-red-100 text-red-800',
  UNKNOWN: 'bg-gray-100 text-gray-600',
};

const VERDICT_LABELS: Record<string, string> = {
  EXEMPLARY: 'Exemplary',
  COMPLIANT: 'Compliant',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
  NON_COMPLIANT: 'Non-Compliant',
  UNKNOWN: 'Unknown',
};

function formatCurrency(amount: number | null): string {
  if (amount === null) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatSpeed(minutes: number | null): string {
  if (minutes === null) return 'No Call';
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h} hours`;
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function ComplianceSection({
  label,
  compliance,
  rationale,
}: {
  label: string;
  compliance: string;
  rationale: string;
}) {
  const colorClass = COMPLIANCE_COLORS[compliance] || COMPLIANCE_COLORS.UNKNOWN;
  return (
    <div className="flex items-start gap-3">
      <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-md ${colorClass}`}>
        {compliance}
      </span>
      <div>
        <span className="text-xs font-medium text-gray-700">{label}</span>
        {rationale && <p className="text-xs text-gray-500 mt-0.5">{rationale}</p>}
      </div>
    </div>
  );
}

export function PplDealPanel({ result, onClose, onReanalyze }: PplDealPanelProps) {
  const [reanalyzing, setReanalyzing] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const metrics = result.metrics as {
    speedToLeadMinutes?: number | null;
    callsIn3BusinessDays?: number;
    touchesIn5BusinessDays?: number;
    channelsUsed?: string[];
    channelDiversity?: number;
    postWeek1TouchesPerWeek?: number | null;
    totalFollowUpAttempts?: number;
    totalCallAttempts?: number;
    totalOutboundEmails?: number;
    meetingBooked?: boolean;
    meetingBookedDate?: string | null;
    createdDayOfWeek?: string;
    emailEngagement?: {
      totalOutboundEmails?: number;
      emailsOpened?: number;
      openRate?: number;
      signal?: string;
      nurtureWindowWeeks?: number;
    };
  };

  // Prorated targets based on deal age
  const ageDays = result.deal_age_days || 0;
  const callTarget = ageDays >= 3 ? 6 : ageDays === 2 ? 5 : ageDays === 1 ? 3 : 2;
  const touchTarget = ageDays >= 5 ? 7 : ageDays === 4 ? 6 : ageDays === 3 ? 5 : ageDays === 2 ? 4 : ageDays === 1 ? 3 : 2;
  const isInProgress = ageDays < 3;

  const hubspotUrl = `https://app.hubspot.com/contacts/7358632/deal/${result.deal_id}`;

  const handleReanalyze = async () => {
    setReanalyzing(true);
    await onReanalyze();
    setReanalyzing(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg z-50 bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between z-10">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-gray-900 truncate">{result.deal_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-500">{formatCurrency(result.amount)}</span>
              <span className="text-gray-300">·</span>
              <span className="text-sm text-gray-500">{result.stage_name}</span>
              <span className="text-gray-300">·</span>
              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${isInProgress ? 'bg-blue-100 text-blue-800' : (VERDICT_BADGE[result.verdict] || VERDICT_BADGE.UNKNOWN)}`}>
                {isInProgress ? 'In Progress' : (VERDICT_LABELS[result.verdict] || result.verdict)}
              </span>
            </div>
            {result.owner_name && (
              <p className="text-xs text-gray-400 mt-1">{result.owner_name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* In Progress Notice */}
          {isInProgress && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-medium text-blue-800">In Progress — Deal is {ageDays} day{ageDays !== 1 ? 's' : ''} old</p>
              <p className="text-xs text-blue-600 mt-1">This deal is still within the initial outreach window. Targets are prorated and the verdict will firm up after 3 business days of activity.</p>
            </div>
          )}

          {/* Executive Summary */}
          {result.executive_summary && !isInProgress && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Executive Summary</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{result.executive_summary}</p>
            </div>
          )}

          {/* Risk Flags */}
          {result.engagement_risk && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm font-medium text-orange-800">Engagement Risk</p>
              <p className="text-xs text-orange-600 mt-1">Prospect is opening emails but rep has stopped outreach. This is the highest-priority coaching moment.</p>
            </div>
          )}
          {result.risk_flag && !result.engagement_risk && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-800">Risk Flag</p>
              <p className="text-xs text-red-600 mt-1">Prospect has gone dark and rep has stopped trying. Consider closing out or re-engaging with a different approach.</p>
            </div>
          )}

          {/* Key Metrics */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Key Metrics</h3>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Speed to Lead" value={formatSpeed(metrics.speedToLeadMinutes ?? null)} />
              <MetricCard label="3-Day Calls" value={`${metrics.callsIn3BusinessDays || 0} / ${callTarget}`} subtitle={ageDays < 3 ? `Day ${ageDays} of 3 — target prorated` : undefined} />
              <MetricCard label="5-Day Touches" value={`${metrics.touchesIn5BusinessDays || 0} / ${touchTarget}`} subtitle={ageDays < 5 ? `Day ${ageDays} of 5 — target prorated` : undefined} />
              <MetricCard label="Channels" value={`${metrics.channelDiversity || 0} used`} subtitle={metrics.channelsUsed?.join(', ')} />
              <MetricCard label="Total Calls" value={String(metrics.totalCallAttempts || 0)} />
              <MetricCard label="Total Emails" value={String(metrics.totalOutboundEmails || 0)} />
              <MetricCard label="Total Follow-ups" value={String(metrics.totalFollowUpAttempts || 0)} />
              {metrics.meetingBooked && (
                <MetricCard label="Meeting Booked" value="Yes" subtitle={metrics.meetingBookedDate ? new Date(metrics.meetingBookedDate).toLocaleDateString() : undefined} />
              )}
            </div>
          </div>

          {/* Email Engagement */}
          {metrics.emailEngagement && (metrics.emailEngagement.totalOutboundEmails ?? 0) > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Email Engagement</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Emails Sent" value={String(metrics.emailEngagement.totalOutboundEmails || 0)} />
                <MetricCard label="Emails Opened" value={String(metrics.emailEngagement.emailsOpened || 0)} />
                <MetricCard label="Open Rate" value={metrics.emailEngagement.openRate != null ? `${Math.round(metrics.emailEngagement.openRate * 100)}%` : '--'} />
                <MetricCard label="Prospect Signal" value={(metrics.emailEngagement.signal || 'NO_DATA').replace(/_/g, ' ')} />
              </div>
              {result.engagement_insight && (
                <p className="text-xs text-gray-500 mt-2 italic">{result.engagement_insight}</p>
              )}
            </div>
          )}

          {/* 3-2-1 Compliance Breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">3-2-1 Compliance</h3>
            {isInProgress && (
              <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 mb-3">
                Preliminary assessment — these ratings will update as activity accumulates over the next few business days.
              </p>
            )}
            <div className="space-y-3">
              <ComplianceSection
                label="Speed to Lead"
                compliance={result.speed_rating}
                rationale={result.speed_rationale}
              />
              <ComplianceSection
                label="THREE — 6 Calls in 3 Business Days"
                compliance={result.three_compliance}
                rationale={result.three_rationale}
              />
              <ComplianceSection
                label="TWO — 6-7 Multi-Channel Touches in 5 Days"
                compliance={result.two_compliance}
                rationale={result.two_rationale}
              />
              <ComplianceSection
                label="ONE — Post-Week-1 Nurture Cadence"
                compliance={result.one_compliance}
                rationale={result.one_rationale}
              />
              <ComplianceSection
                label="Channel Diversity"
                compliance={result.channel_diversity_rating === 'HIGH' ? 'COMPLIANT' : result.channel_diversity_rating === 'ADEQUATE' ? 'PARTIAL' : 'NON_COMPLIANT'}
                rationale={`${metrics.channelDiversity || 0} channels used: ${metrics.channelsUsed?.join(', ') || 'None'}`}
              />
            </div>
          </div>

          {/* Coaching */}
          {result.coaching && !isInProgress && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Coaching Point</h3>
              <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-lg">{result.coaching}</p>
            </div>
          )}

          {/* Activity Timeline */}
          {result.timeline && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Activity Timeline</h3>
              <pre className="text-xs text-gray-600 bg-gray-50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                {result.timeline}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
            <a
              href={hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <ExternalLinkIcon />
              View in HubSpot
            </a>
            <button
              onClick={handleReanalyze}
              disabled={reanalyzing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {reanalyzing ? 'Re-analyzing...' : 'Re-analyze'}
            </button>
          </div>

          {/* Metadata */}
          <div className="text-[10px] text-gray-400 pt-2">
            <p>Created: {new Date(result.create_date).toLocaleDateString()} ({metrics.createdDayOfWeek || ''})</p>
            <p>Deal Age: {result.deal_age_days} days</p>
            <p>Analyzed: {new Date(result.analyzed_at).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function MetricCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 font-medium">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-0.5">{value}</p>
      {subtitle && <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}
