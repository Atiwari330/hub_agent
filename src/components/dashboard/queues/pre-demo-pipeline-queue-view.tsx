'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { StalledSeverity } from '@/lib/utils/queue-detection';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';

// ===== Types =====

interface PreDemoDealWithMetadata {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  lastActivityDate: string | null;
  nextActivityDate: string | null;
  nextStep: string | null;
  hubspotCreatedAt: string | null;
  sqlEnteredAt: string | null;
  discoveryEnteredAt: string | null;
  demoScheduledEnteredAt: string | null;
  daysInCurrentStage: number;
  currentStageEnteredAt: string | null;
  daysSinceActivity: number;
  dealAgeDays: number;
  hasNextStep: boolean;
  hasFutureActivity: boolean;
  nextStepOverdue: boolean;
  closeDateInPast: boolean;
  daysUntilClose: number | null;
  nextStepDueDate: string | null;
  nextStepStatus: string | null;
  nextStepActionType: string | null;
  nextStepConfidence: number | null;
  nextStepDisplayMessage: string | null;
  nextStepAnalyzedAt: string | null;
}

interface AnalysisData {
  status: string;
  dueDate: string | null;
  confidence: number | null;
  displayMessage: string | null;
  actionType: string | null;
  analyzedAt: string | null;
}

interface ActivityCheckData {
  verdict: string;
  confidence: number;
  summary: string;
  details: string;
  evidence: {
    recentEmails: number;
    recentCalls: number;
    recentNotes: number;
    recentTasks: number;
    lastOutreachDate: string | null;
    outreachTypes: string[];
  };
  checkedAt: string;
  cached: boolean;
}

interface ThresholdConfig {
  watchThreshold: number;
  warningThreshold: number;
  criticalThreshold: number;
}

type PresetName = 'strict' | 'default' | 'lenient' | 'custom';
type CloseDateProximity = 'all' | 'past_due' | 'within_14' | 'within_30';
type BooleanFilter = 'all' | 'yes' | 'no';
type QuarterFilter = 'q1' | 'q2' | 'q3' | 'q4' | 'all';

interface ProcessedDeal extends PreDemoDealWithMetadata {
  severity: StalledSeverity;
}

type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'stageName' | 'daysInCurrentStage';
type SortDirection = 'asc' | 'desc';

// ===== Quarter Filter Helpers =====

function getQuarterOptions(): { value: QuarterFilter; label: string; year: number }[] {
  const currentQ = getCurrentQuarter();
  return [
    { value: 'q1', label: `Q1 ${currentQ.year}`, year: currentQ.year },
    { value: 'q2', label: `Q2 ${currentQ.year}`, year: currentQ.year },
    { value: 'q3', label: `Q3 ${currentQ.year}`, year: currentQ.year },
    { value: 'q4', label: `Q4 ${currentQ.year}`, year: currentQ.year },
    { value: 'all', label: 'All Quarters', year: currentQ.year },
  ];
}

function getCurrentQuarterFilter(): QuarterFilter {
  const currentQ = getCurrentQuarter();
  return `q${currentQ.quarter}` as QuarterFilter;
}

// ===== Presets =====

const PRESETS: Record<Exclude<PresetName, 'custom'>, ThresholdConfig> = {
  strict: {
    watchThreshold: 3,
    warningThreshold: 5,
    criticalThreshold: 8,
  },
  default: {
    watchThreshold: 5,
    warningThreshold: 10,
    criticalThreshold: 15,
  },
  lenient: {
    watchThreshold: 10,
    warningThreshold: 15,
    criticalThreshold: 20,
  },
};

// ===== Constants =====

const SEVERITY_COLORS: Record<StalledSeverity, { bg: string; text: string; dot: string; label: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-600', dot: 'bg-red-500', label: 'Critical' },
  warning: { bg: 'bg-orange-100', text: 'text-orange-500', dot: 'bg-orange-500', label: 'Warning' },
  watch: { bg: 'bg-yellow-100', text: 'text-yellow-500', dot: 'bg-yellow-500', label: 'Watch' },
};

const TOTAL_COLUMNS = 9; // chevron + 8 data columns

// ===== Helpers =====

function detectPreset(config: ThresholdConfig): PresetName {
  for (const [name, preset] of Object.entries(PRESETS) as [Exclude<PresetName, 'custom'>, ThresholdConfig][]) {
    if (
      config.watchThreshold === preset.watchThreshold &&
      config.warningThreshold === preset.warningThreshold &&
      config.criticalThreshold === preset.criticalThreshold
    ) {
      return name;
    }
  }
  return 'custom';
}

function computeSeverity(daysInStage: number, thresholds: ThresholdConfig): StalledSeverity | null {
  if (daysInStage >= thresholds.criticalThreshold) return 'critical';
  if (daysInStage >= thresholds.warningThreshold) return 'warning';
  if (daysInStage >= thresholds.watchThreshold) return 'watch';
  return null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Extract effective analysis from API data + any fresh overrides */
function getEffectiveAnalysis(
  deal: ProcessedDeal,
  freshAnalyses: Record<string, AnalysisData>
): AnalysisData | null {
  if (freshAnalyses[deal.id]) {
    return freshAnalyses[deal.id];
  }
  if (deal.nextStepAnalyzedAt && deal.nextStepStatus) {
    return {
      status: deal.nextStepStatus,
      dueDate: deal.nextStepDueDate,
      confidence: deal.nextStepConfidence,
      displayMessage: deal.nextStepDisplayMessage,
      actionType: deal.nextStepActionType,
      analyzedAt: deal.nextStepAnalyzedAt,
    };
  }
  return null;
}

/** Returns Tailwind bg class for the inline AI dot indicator */
function getAiDotColor(analysis: AnalysisData | null): string | null {
  if (!analysis) return null;

  const { status, dueDate } = analysis;

  if (status === 'date_found' || status === 'date_inferred') {
    if (dueDate) {
      const due = new Date(dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      due.setHours(0, 0, 0, 0);
      if (due < today) return 'bg-red-500';
    }
    return 'bg-emerald-500';
  }

  if (status === 'awaiting_external') return 'bg-blue-500';
  if (status === 'date_unclear') return 'bg-amber-500';

  return 'bg-gray-400';
}

// ===== Sub-Components =====

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-gray-500 whitespace-nowrap">{label}:</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= 0) onChange(v);
        }}
        className="w-14 text-sm border border-gray-300 rounded px-1.5 py-1 text-center bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="inline-flex p-1 rounded hover:bg-gray-200 transition-colors">
      <svg
        className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}

function StageDiagnosisFactors({ deal }: { deal: ProcessedDeal }) {
  interface Factor {
    label: string;
    severity: 'critical' | 'warning' | 'info';
  }

  const factors: Factor[] = [];
  const stageId = deal.stageId;

  // Primary factor: days in current stage
  factors.push({
    label: `${deal.daysInCurrentStage} business days in ${deal.stageName}`,
    severity: deal.severity === 'critical' ? 'critical' : deal.severity === 'warning' ? 'warning' : 'info',
  });

  // Stage-specific diagnosis
  if (stageId === '17915773') {
    // SQL stage
    if (!deal.discoveryEnteredAt) {
      factors.push({ label: 'Never entered Discovery', severity: 'warning' });
    }
    if (!deal.hasFutureActivity) {
      factors.push({ label: 'No discovery call scheduled', severity: 'warning' });
    }
  } else if (stageId === '138092708') {
    // Discovery stage
    if (!deal.demoScheduledEnteredAt) {
      factors.push({ label: 'No demo has been scheduled', severity: 'warning' });
    }
    if (!deal.hasFutureActivity) {
      factors.push({ label: 'No upcoming meetings', severity: 'warning' });
    }
  } else if (stageId === 'baedc188-ba76-4a41-8723-5bb99fe7c5bf') {
    // Demo Scheduled stage
    if (deal.nextActivityDate) {
      const activityPast = new Date(deal.nextActivityDate) < new Date();
      if (activityPast) {
        factors.push({ label: 'Scheduled activity date has passed - update stage?', severity: 'critical' });
      }
    } else {
      factors.push({ label: 'Demo scheduled but no activity date set', severity: 'warning' });
    }
  }

  // Common factors
  if (!deal.hasNextStep) {
    factors.push({ label: 'No next step defined', severity: 'warning' });
  }

  if (deal.closeDateInPast) {
    factors.push({ label: 'Close date has passed', severity: 'critical' });
  } else if (deal.daysUntilClose !== null && deal.daysUntilClose <= 14) {
    factors.push({ label: `Close date in ${deal.daysUntilClose} days`, severity: 'warning' });
  }

  if (deal.daysSinceActivity > 5) {
    factors.push({ label: `${deal.daysSinceActivity} days since last activity`, severity: deal.daysSinceActivity > 10 ? 'warning' : 'info' });
  }

  const severityIcon: Record<Factor['severity'], string> = {
    critical: 'text-red-500',
    warning: 'text-amber-500',
    info: 'text-blue-500',
  };

  const severityDot: Record<Factor['severity'], string> = {
    critical: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
  };

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Why is this deal here?
      </h4>
      <ul className="space-y-1.5">
        {factors.map((factor, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${severityDot[factor.severity]}`} />
            <span className={severityIcon[factor.severity]}>{factor.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiAnalysisCard({ analysis }: { analysis: AnalysisData | null }) {
  if (!analysis) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <p className="text-sm text-gray-400 italic">Not yet analyzed</p>
        <p className="text-xs text-gray-400 mt-1">Click Analyze to run AI analysis on the next step.</p>
      </div>
    );
  }

  const statusConfig: Record<string, { icon: string; bg: string; text: string }> = {
    date_found: { icon: '\u2705', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    date_inferred: { icon: '\u{1F4C5}', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    no_date: { icon: '\u2796', bg: 'bg-gray-50', text: 'text-gray-600' },
    date_unclear: { icon: '\u2753', bg: 'bg-amber-50', text: 'text-amber-700' },
    awaiting_external: { icon: '\u23F3', bg: 'bg-blue-50', text: 'text-blue-700' },
    empty: { icon: '\u2205', bg: 'bg-gray-50', text: 'text-gray-500' },
    unparseable: { icon: '\u2717', bg: 'bg-gray-50', text: 'text-gray-500' },
  };

  const config = statusConfig[analysis.status] || statusConfig.unparseable;

  let isOverdue = false;
  if (analysis.dueDate && (analysis.status === 'date_found' || analysis.status === 'date_inferred')) {
    const due = new Date(analysis.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    isOverdue = due < today;
  }

  const borderClass = isOverdue ? 'border-red-300' : 'border-gray-200';
  const bgClass = isOverdue ? 'bg-red-50' : config.bg;

  return (
    <div className={`${bgClass} border ${borderClass} rounded-lg p-3`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm">{config.icon}</span>
        <span className={`text-sm font-medium ${isOverdue ? 'text-red-700' : config.text}`}>
          {analysis.displayMessage || analysis.status}
        </span>
      </div>
      <div className="space-y-1 text-xs text-gray-500">
        <div><span className="text-gray-400">Status:</span> {analysis.status.replace(/_/g, ' ')}</div>
        {analysis.dueDate && (
          <div>
            <span className="text-gray-400">Due:</span>{' '}
            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>{formatDate(analysis.dueDate)}</span>
            {isOverdue && <span className="text-red-600 ml-1">(overdue)</span>}
          </div>
        )}
        {analysis.actionType && (
          <div><span className="text-gray-400">Action:</span> {analysis.actionType.replace(/_/g, ' ')}</div>
        )}
        {analysis.confidence !== null && (
          <div><span className="text-gray-400">Confidence:</span> {Math.round(analysis.confidence * 100)}%</div>
        )}
        {analysis.analyzedAt && (
          <div className="pt-1 border-t border-gray-200 mt-1">
            <span className="text-gray-400">Analyzed:</span> {formatDate(analysis.analyzedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyzeButton({
  isAnalyzing,
  onAnalyze,
}: {
  isAnalyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <button
      onClick={onAnalyze}
      disabled={isAnalyzing}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        isAnalyzing
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
      }`}
      title="Analyze next step with AI"
    >
      {isAnalyzing ? (
        <>
          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Analyzing...</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Analyze</span>
        </>
      )}
    </button>
  );
}

function CheckActivityButton({
  isChecking,
  hasResult,
  onCheck,
}: {
  isChecking: boolean;
  hasResult: boolean;
  onCheck: (force: boolean) => void;
}) {
  return (
    <button
      onClick={() => onCheck(hasResult)}
      disabled={isChecking}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        isChecking
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
      }`}
      title={hasResult ? "Re-check engagement activity (bypass cache)" : "Check recent engagement activity from HubSpot"}
    >
      {isChecking ? (
        <>
          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Checking...</span>
        </>
      ) : hasResult ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Recheck Activity</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span>Check Activity</span>
        </>
      )}
    </button>
  );
}

function ActivityCheckCard({ data }: { data: ActivityCheckData }) {
  const [showDetails, setShowDetails] = useState(false);

  const verdictConfig: Record<string, { bg: string; border: string; text: string; icon: string; label: string }> = {
    actively_engaging: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', icon: '\u2713', label: 'Actively Engaging' },
    minimal_effort: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', icon: '\u26A0', label: 'Minimal Effort' },
    no_engagement: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', icon: '\u2717', label: 'No Engagement' },
    inconclusive: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-600', icon: '?', label: 'Inconclusive' },
  };

  const config = verdictConfig[data.verdict] || verdictConfig.inconclusive;

  const evidenceParts: string[] = [];
  if (data.evidence.recentEmails > 0) evidenceParts.push(`${data.evidence.recentEmails} email${data.evidence.recentEmails !== 1 ? 's' : ''} sent`);
  if (data.evidence.recentCalls > 0) evidenceParts.push(`${data.evidence.recentCalls} call${data.evidence.recentCalls !== 1 ? 's' : ''} made`);
  if (data.evidence.recentNotes > 0) evidenceParts.push(`${data.evidence.recentNotes} note${data.evidence.recentNotes !== 1 ? 's' : ''}`);
  if (data.evidence.recentTasks > 0) evidenceParts.push(`${data.evidence.recentTasks} task${data.evidence.recentTasks !== 1 ? 's' : ''}`);

  return (
    <div className={`${config.bg} border ${config.border} rounded-lg p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold ${config.bg} ${config.text}`}>
            {config.icon}
          </span>
          <span className={`text-sm font-semibold ${config.text}`}>{config.label}</span>
          <span className="text-xs text-gray-400">({Math.round(data.confidence * 100)}% confidence)</span>
        </div>
        {data.cached && (
          <span className="text-xs text-gray-400">(cached)</span>
        )}
      </div>

      <p className="text-sm text-gray-700 mb-2">{data.summary}</p>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {evidenceParts.length > 0 && (
          <span>{evidenceParts.join(', ')}</span>
        )}
        {evidenceParts.length === 0 && (
          <span>No outreach activity found</span>
        )}
        {data.evidence.lastOutreachDate && (
          <>
            <span className="text-gray-300">|</span>
            <span>Last outreach: {formatDate(data.evidence.lastOutreachDate)}</span>
          </>
        )}
        <span className="text-gray-300">|</span>
        <span>Checked: {formatDate(data.checkedAt)}</span>
      </div>

      {data.details && (
        <div className="mt-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <svg className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showDetails ? 'Hide details' : 'Show details'}
          </button>
          {showDetails && (
            <p className="mt-2 text-xs text-gray-600 leading-relaxed bg-white bg-opacity-60 rounded p-2">
              {data.details}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ExpandedDealPanel({
  deal,
  analysis,
  isAnalyzing,
  onAnalyze,
  activityCheck,
  isCheckingActivity,
  onCheckActivity,
}: {
  deal: ProcessedDeal;
  analysis: AnalysisData | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  activityCheck: ActivityCheckData | null;
  isCheckingActivity: boolean;
  onCheckActivity: (force: boolean) => void;
}) {
  return (
    <div className="p-5 bg-slate-50 border-t border-gray-200 space-y-4">
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Stage-specific Diagnosis */}
        <StageDiagnosisFactors deal={deal} />

        {/* Center: Next Step + AI Analysis */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Next Step Analysis
          </h4>
          {deal.nextStep && (
            <p className="text-sm text-gray-700 mb-3 bg-white border border-gray-200 rounded p-2">
              {deal.nextStep}
            </p>
          )}
          <AiAnalysisCard analysis={analysis} />
        </div>

        {/* Right: Actions */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Actions
          </h4>
          <div className="space-y-2">
            <AnalyzeButton isAnalyzing={isAnalyzing} onAnalyze={onAnalyze} />
            <CheckActivityButton isChecking={isCheckingActivity} hasResult={!!activityCheck} onCheck={onCheckActivity} />
            <a
              href={getHubSpotDealUrl(deal.hubspotDealId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Open in HubSpot
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Activity Check Results - full width below grid */}
      {activityCheck && (
        <ActivityCheckCard data={activityCheck} />
      )}
    </div>
  );
}

// ===== Main Component =====

export function PreDemoPipelineQueueView() {
  // Raw API data
  const [allDeals, setAllDeals] = useState<PreDemoDealWithMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Thresholds
  const [thresholds, setThresholds] = useState<ThresholdConfig>({ ...PRESETS.default });
  const [thresholdsOpen, setThresholdsOpen] = useState(false);

  // Quarter filter
  const [quarterFilter, setQuarterFilter] = useState<QuarterFilter>(getCurrentQuarterFilter());
  const quarterOptions = useMemo(() => getQuarterOptions(), []);
  const currentYear = quarterOptions[0]?.year || new Date().getFullYear();

  // Filters
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);
  const [closeDateFilter, setCloseDateFilter] = useState<CloseDateProximity>('all');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [nextStepFilter, setNextStepFilter] = useState<BooleanFilter>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysInCurrentStage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Expandable rows
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // AI analysis state
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());
  const [dealAnalyses, setDealAnalyses] = useState<Record<string, AnalysisData>>({});

  // Activity check state
  const [activityChecking, setActivityChecking] = useState<Set<string>>(new Set());
  const [activityResults, setActivityResults] = useState<Record<string, ActivityCheckData>>({});

  // Derived
  const activePreset = useMemo(() => detectPreset(thresholds), [thresholds]);

  const applyPreset = (name: Exclude<PresetName, 'custom'>) => {
    setThresholds({ ...PRESETS[name] });
  };

  const updateThreshold = <K extends keyof ThresholdConfig>(key: K, value: ThresholdConfig[K]) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
  };

  // Extract unique AEs
  const uniqueAEs = useMemo(() => {
    const aes = new Map<string, string>();
    for (const deal of allDeals) {
      if (deal.ownerId && deal.ownerName) {
        aes.set(deal.ownerId, deal.ownerName);
      }
    }
    return Array.from(aes.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allDeals]);

  // Extract unique stages
  const uniqueStages = useMemo(() => {
    const stages = new Set<string>();
    for (const deal of allDeals) {
      if (deal.stageName) stages.add(deal.stageName);
    }
    return Array.from(stages).sort();
  }, [allDeals]);

  // Client-side filtering + sorting
  const processedDeals = useMemo(() => {
    // Step 0: Filter by quarter
    let quarterFiltered = allDeals;
    if (quarterFilter !== 'all') {
      const quarterNum = parseInt(quarterFilter.replace('q', ''), 10);
      const qi = getQuarterInfo(currentYear, quarterNum);
      quarterFiltered = allDeals.filter((deal) => {
        if (!deal.closeDate) return false;
        const closeTime = new Date(deal.closeDate).getTime();
        return closeTime >= qi.startDate.getTime() && closeTime <= qi.endDate.getTime();
      });
    }

    // Step 1: Apply severity thresholds (only show deals meeting watch threshold or above)
    const qualifiedDeals: ProcessedDeal[] = [];

    for (const deal of quarterFiltered) {
      const severity = computeSeverity(deal.daysInCurrentStage, thresholds);
      if (severity) {
        qualifiedDeals.push({ ...deal, severity });
      }
    }

    // Step 2: Apply filters
    let result = qualifiedDeals;

    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.stageName));
    }

    if (closeDateFilter !== 'all') {
      result = result.filter((d) => {
        if (closeDateFilter === 'past_due') return d.closeDateInPast;
        if (closeDateFilter === 'within_14') return d.daysUntilClose !== null && d.daysUntilClose <= 14;
        if (closeDateFilter === 'within_30') return d.daysUntilClose !== null && d.daysUntilClose <= 30;
        return true;
      });
    }

    const parsedMin = amountMin ? parseFloat(amountMin) : null;
    const parsedMax = amountMax ? parseFloat(amountMax) : null;
    if (parsedMin !== null && !isNaN(parsedMin)) {
      result = result.filter((d) => d.amount !== null && d.amount >= parsedMin);
    }
    if (parsedMax !== null && !isNaN(parsedMax)) {
      result = result.filter((d) => d.amount !== null && d.amount <= parsedMax);
    }

    if (nextStepFilter !== 'all') {
      result = result.filter((d) => (nextStepFilter === 'yes') === d.hasNextStep);
    }

    // Step 3: Sort
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'dealName':
          comparison = a.dealName.localeCompare(b.dealName);
          break;
        case 'ownerName':
          comparison = a.ownerName.localeCompare(b.ownerName);
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'daysInCurrentStage':
          comparison = a.daysInCurrentStage - b.daysInCurrentStage;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [allDeals, thresholds, quarterFilter, currentYear, aeFilter, stageFilter, closeDateFilter, amountMin, amountMax, nextStepFilter, sortColumn, sortDirection]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, watch: 0 };
    for (const deal of processedDeals) {
      c[deal.severity]++;
    }
    return c;
  }, [processedDeals]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/pre-demo-pipeline');
      if (!response.ok) {
        throw new Error('Failed to fetch deals');
      }
      const json = await response.json();
      setAllDeals(json.deals || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const toggleExpanded = (dealId: string) => {
    setExpandedDealId((prev) => (prev === dealId ? null : dealId));
  };

  const handleAnalyze = useCallback(async (dealId: string, ownerId: string) => {
    setAnalyzingDeals((prev) => new Set(prev).add(dealId));
    try {
      const response = await fetch(`/api/ae/${ownerId}/deals/${dealId}/analyze-next-step`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Analysis failed');
      }
      const result = await response.json();
      if (result.analysis) {
        setDealAnalyses((prev) => ({
          ...prev,
          [dealId]: {
            status: result.analysis.status,
            dueDate: result.analysis.dueDate,
            confidence: result.analysis.confidence,
            displayMessage: result.analysis.displayMessage,
            actionType: result.analysis.actionType,
            analyzedAt: result.analyzedAt,
          },
        }));
      }
    } catch (err) {
      console.error('Failed to analyze deal:', err);
    } finally {
      setAnalyzingDeals((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }, []);

  const handleCheckActivity = useCallback(async (dealId: string, force = false) => {
    setActivityChecking((prev) => new Set(prev).add(dealId));
    try {
      const response = await fetch(`/api/deals/${dealId}/check-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!response.ok) {
        throw new Error('Activity check failed');
      }
      const result: ActivityCheckData = await response.json();
      setActivityResults((prev) => ({
        ...prev,
        [dealId]: result,
      }));
    } catch (err) {
      console.error('Failed to check activity:', err);
    } finally {
      setActivityChecking((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }, []);

  const hasActiveFilters =
    aeFilter !== 'all' ||
    stageFilter.length > 0 ||
    closeDateFilter !== 'all' ||
    amountMin !== '' ||
    amountMax !== '' ||
    nextStepFilter !== 'all';

  const clearFilters = () => {
    setAeFilter('all');
    setStageFilter([]);
    setCloseDateFilter('all');
    setAmountMin('');
    setAmountMax('');
    setNextStepFilter('all');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pre-Demo Pipeline</h1>
        <p className="text-sm text-gray-600 mt-1">
          Deals in early stages (SQL, Discovery, Demo Scheduled) that aren&apos;t progressing toward Demo Completed.
        </p>
      </div>

      {/* Presets */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-700">Presets:</span>
        {(['strict', 'default', 'lenient'] as const).map((name) => (
          <button
            key={name}
            onClick={() => applyPreset(name)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              activePreset === name
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </button>
        ))}
        {activePreset === 'custom' && (
          <span className="px-3 py-1.5 text-sm font-medium rounded-lg border bg-gray-100 text-gray-500 border-gray-300">
            Custom
          </span>
        )}
        <button
          onClick={() => setThresholdsOpen(!thresholdsOpen)}
          className="ml-2 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg className={`w-4 h-4 transition-transform ${thresholdsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {thresholdsOpen ? 'Hide thresholds' : 'Show thresholds'}
        </button>
      </div>

      {/* Thresholds Panel (collapsible) */}
      {thresholdsOpen && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <NumberInput
              label="Watch"
              value={thresholds.watchThreshold}
              onChange={(v) => updateThreshold('watchThreshold', v)}
            />
            <NumberInput
              label="Warning"
              value={thresholds.warningThreshold}
              onChange={(v) => updateThreshold('warningThreshold', v)}
            />
            <NumberInput
              label="Critical"
              value={thresholds.criticalThreshold}
              onChange={(v) => updateThreshold('criticalThreshold', v)}
            />
            <span className="text-xs text-gray-400">(business days in current stage)</span>
          </div>
        </div>
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Quarter Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Quarter:</label>
          <select
            value={quarterFilter}
            onChange={(e) => setQuarterFilter(e.target.value as QuarterFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {quarterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* AE Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">AE:</label>
          <select
            value={aeFilter}
            onChange={(e) => setAeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All AEs</option>
            {uniqueAEs.map((ae) => (
              <option key={ae.id} value={ae.id}>{ae.name}</option>
            ))}
          </select>
        </div>

        {/* Stage Filter */}
        <div className="flex items-center gap-2 relative">
          <label className="text-sm text-gray-600">Stage:</label>
          <button
            onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center gap-2 min-w-[120px]"
          >
            <span>{stageFilter.length === 0 ? 'All Stages' : `${stageFilter.length} Stage${stageFilter.length > 1 ? 's' : ''}`}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {stageDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setStageDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                {uniqueStages.map((stage) => (
                  <label
                    key={stage}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={stageFilter.includes(stage)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setStageFilter([...stageFilter, stage]);
                        } else {
                          setStageFilter(stageFilter.filter((s) => s !== stage));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">{stage}</span>
                  </label>
                ))}
                {stageFilter.length > 0 && (
                  <button
                    onClick={() => setStageFilter([])}
                    className="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 border-t border-gray-200 text-left"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Amount Range */}
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-gray-600">Amount:</label>
          <input
            type="number"
            placeholder="Min"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            className="w-20 text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-gray-400">-</span>
          <input
            type="number"
            placeholder="Max"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            className="w-20 text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Next Step */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Next Step:</label>
          <select
            value={nextStepFilter}
            onChange={(e) => setNextStepFilter(e.target.value as BooleanFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        {/* Close Date Proximity */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Close Date:</label>
          <select
            value={closeDateFilter}
            onChange={(e) => setCloseDateFilter(e.target.value as CloseDateProximity)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="past_due">Past Due</option>
            <option value="within_14">Within 14 Days</option>
            <option value="within_30">Within 30 Days</option>
          </select>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Summary Badges */}
      {!loading && allDeals.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-red-100 text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {counts.critical} Critical
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-orange-100 text-orange-700">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            {counts.warning} Warning
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-yellow-100 text-yellow-700">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {counts.watch} Watch
          </span>
          <span className="text-sm text-gray-500 ml-2">
            {processedDeals.length} total
          </span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && processedDeals.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No pre-demo pipeline deals</h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters
              ? 'No deals match the current filters. Try adjusting the thresholds or filters.'
              : 'All pre-demo deals are progressing through stages within expected timeframes.'}
          </p>
        </div>
      )}

      {/* Deals Table */}
      {!loading && !error && processedDeals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-10 px-2 py-3" />
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Deal Name</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ownerName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>AE</span>
                      <SortIcon active={sortColumn === 'ownerName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Amount</span>
                      <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('stageName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Stage</span>
                      <SortIcon active={sortColumn === 'stageName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('daysInCurrentStage')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Days in Stage</span>
                      <SortIcon active={sortColumn === 'daysInCurrentStage'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Stage Entered
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Next Step
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Close Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedDeals.map((deal) => {
                  const sevStyle = SEVERITY_COLORS[deal.severity];
                  const isExpanded = expandedDealId === deal.id;
                  const analysis = getEffectiveAnalysis(deal, dealAnalyses);
                  const aiDotColor = getAiDotColor(analysis);

                  return (
                    <React.Fragment key={deal.id}>
                      <tr
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
                        onClick={() => toggleExpanded(deal.id)}
                      >
                        <td className="px-2 py-3 text-center">
                          <ChevronIcon expanded={isExpanded} />
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={getHubSpotDealUrl(deal.hubspotDealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deal.dealName}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{deal.ownerName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-900 whitespace-nowrap">
                            {deal.amount ? formatCurrency(deal.amount) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 whitespace-nowrap">{deal.stageName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-bold tabular-nums ${sevStyle.text}`}>
                            {deal.daysInCurrentStage}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 whitespace-nowrap">
                            {formatDate(deal.currentStageEnteredAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          {deal.nextStep ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-gray-600 truncate" title={deal.nextStep}>
                                {deal.nextStep}
                              </span>
                              {deal.nextStepOverdue && (
                                <span className="flex-shrink-0 text-xs text-red-600 font-medium">(overdue)</span>
                              )}
                              {aiDotColor && (
                                <span
                                  className={`flex-shrink-0 w-2 h-2 rounded-full ${aiDotColor}`}
                                  title={analysis?.displayMessage || 'AI analyzed'}
                                />
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-gray-400 italic">None</span>
                              {aiDotColor && (
                                <span
                                  className={`flex-shrink-0 w-2 h-2 rounded-full ${aiDotColor}`}
                                  title={analysis?.displayMessage || 'AI analyzed'}
                                />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm whitespace-nowrap ${
                              deal.closeDateInPast
                                ? 'text-red-600 font-medium'
                                : deal.daysUntilClose !== null && deal.daysUntilClose <= 14
                                ? 'text-amber-600 font-medium'
                                : 'text-gray-600'
                            }`}>
                              {formatDate(deal.closeDate)}
                            </span>
                            {deal.closeDateInPast && (
                              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500" title="Close date is in the past" />
                            )}
                            {!deal.closeDateInPast && deal.daysUntilClose !== null && deal.daysUntilClose <= 14 && (
                              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500" title="Close date within 14 days" />
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={TOTAL_COLUMNS} className="p-0">
                            <ExpandedDealPanel
                              deal={deal}
                              analysis={analysis}
                              isAnalyzing={analyzingDeals.has(deal.id)}
                              onAnalyze={() => handleAnalyze(deal.id, deal.ownerId)}
                              activityCheck={activityResults[deal.id] || null}
                              isCheckingActivity={activityChecking.has(deal.id)}
                              onCheckActivity={(force) => handleCheckActivity(deal.id, force)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
