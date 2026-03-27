'use client';

import type { PplResult } from './ppl-dashboard';

interface PplDealCardProps {
  result: PplResult;
  onClick: () => void;
}

const VERDICT_BORDER: Record<string, string> = {
  EXEMPLARY: 'border-l-green-500',
  COMPLIANT: 'border-l-emerald-500',
  NEEDS_IMPROVEMENT: 'border-l-orange-400',
  NON_COMPLIANT: 'border-l-red-500',
  UNKNOWN: 'border-l-gray-300',
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
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function daysAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// Compliance bar component
function ComplianceBar({
  label,
  value,
  target,
  suffix,
  rating,
}: {
  label: string;
  value: number;
  target: number;
  suffix?: string;
  rating?: 'met' | 'partial' | 'missed';
}) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  const effectiveRating = rating || (pct >= 85 ? 'met' : pct >= 50 ? 'partial' : 'missed');
  const barColor =
    effectiveRating === 'met'
      ? 'bg-green-500'
      : effectiveRating === 'partial'
      ? 'bg-amber-400'
      : 'bg-red-400';
  const textColor =
    effectiveRating === 'met'
      ? 'text-green-700'
      : effectiveRating === 'partial'
      ? 'text-amber-700'
      : 'text-red-600';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-20 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium w-20 ${textColor}`}>
        {suffix || `${value}/${target}`}
      </span>
    </div>
  );
}

// Activity sparkline
function ActivitySparkline({
  touchTimestamps,
  createDate,
  dealAgeDays,
}: {
  touchTimestamps: Array<{ date: string; type: 'call' | 'email' }>;
  createDate: string;
  dealAgeDays: number;
}) {
  const created = new Date(createDate).getTime();
  const totalDays = Math.max(dealAgeDays, 7);
  const width = 240;
  const height = 20;

  // Day 3 and Day 5 markers
  const day3X = Math.min((3 / totalDays) * width, width);
  const day5X = Math.min((5 / totalDays) * width, width);

  return (
    <svg width={width} height={height} className="block">
      {/* Background line */}
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#e5e7eb" strokeWidth={1} />
      {/* Day 3 marker */}
      <line x1={day3X} y1={2} x2={day3X} y2={height - 2} stroke="#d1d5db" strokeWidth={1} strokeDasharray="2,2" />
      {/* Day 5 marker */}
      <line x1={day5X} y1={2} x2={day5X} y2={height - 2} stroke="#d1d5db" strokeWidth={1} strokeDasharray="2,2" />
      {/* Touch dots */}
      {touchTimestamps.map((t, i) => {
        const daysSinceCreate = (new Date(t.date).getTime() - created) / (1000 * 60 * 60 * 24);
        const x = Math.max(2, Math.min(width - 2, (daysSinceCreate / totalDays) * width));
        const fill = t.type === 'call' ? '#22c55e' : '#3b82f6';
        return <circle key={i} cx={x} cy={height / 2} r={2.5} fill={fill} opacity={0.8} />;
      })}
    </svg>
  );
}

export function PplDealCard({ result, onClick }: PplDealCardProps) {
  const metrics = result.metrics as {
    speedToLeadMinutes?: number | null;
    speedToLeadRating?: string;
    callsIn3BusinessDays?: number;
    touchesIn5BusinessDays?: number;
    channelDiversity?: number;
    postWeek1TouchesPerWeek?: number | null;
    postWeek1Assessment?: string;
    totalCallAttempts?: number;
    totalOutboundEmails?: number;
    touchTimestamps?: Array<{ date: string; type: 'call' | 'email' }>;
    emailEngagement?: {
      totalOutboundEmails?: number;
      emailsOpened?: number;
      openRate?: number;
      signal?: string;
    };
  };

  // Speed to lead bar — use actual minutes, not LLM rating
  const speedMins = metrics.speedToLeadMinutes;
  const speedRating: 'met' | 'partial' | 'missed' =
    speedMins !== null && speedMins !== undefined
      ? speedMins <= 5 ? 'met' : speedMins <= 30 ? 'partial' : 'missed'
      : 'missed'; // NO_CALL
  const speedVal =
    speedMins !== null && speedMins !== undefined
      ? speedMins <= 5 ? 100 : speedMins <= 30 ? 60 : 30
      : 0;

  // Dynamic targets based on deal age (prorate for young deals)
  const ageDays = result.deal_age_days || 0;
  const callTarget = ageDays >= 3 ? 6 : ageDays === 2 ? 5 : ageDays === 1 ? 3 : 2;
  const touchTarget = ageDays >= 5 ? 7 : ageDays === 4 ? 6 : ageDays === 3 ? 5 : ageDays === 2 ? 4 : ageDays === 1 ? 3 : 2;

  // Nurture bar — 2-3 touches/week target, only through week 3
  const nurtureRating: 'met' | 'partial' | 'missed' =
    metrics.postWeek1Assessment === 'TOO_EARLY'
      ? 'partial'
      : ageDays > 21
      ? 'met' // past week 3, nurture period is done
      : (metrics.postWeek1TouchesPerWeek ?? 0) >= 2
      ? 'met'
      : (metrics.postWeek1TouchesPerWeek ?? 0) >= 1
      ? 'partial'
      : 'missed';
  const nurtureVal =
    metrics.postWeek1Assessment === 'TOO_EARLY' ? 50
    : ageDays > 21 ? 100
    : Math.min(100, Math.round(((metrics.postWeek1TouchesPerWeek ?? 0) / 2.5) * 100));
  const nurtureSuffix =
    metrics.postWeek1Assessment === 'TOO_EARLY' ? 'Too Early'
    : ageDays > 21 ? 'Complete'
    : `${(metrics.postWeek1TouchesPerWeek ?? 0).toFixed(1)}/wk`;

  const emailEng = metrics.emailEngagement;
  const openRate = emailEng?.openRate != null ? Math.round(emailEng.openRate * 100) : null;
  const touchTimestamps = metrics.touchTimestamps || [];
  const isInProgress = ageDays < 3;

  const borderColor = isInProgress ? 'border-l-blue-400' : (VERDICT_BORDER[result.verdict] || VERDICT_BORDER.UNKNOWN);
  const badgeClass = isInProgress ? 'bg-blue-100 text-blue-800' : (VERDICT_BADGE[result.verdict] || VERDICT_BADGE.UNKNOWN);
  const badgeLabel = isInProgress ? 'In Progress' : (VERDICT_LABELS[result.verdict] || result.verdict);

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 border-l-4 ${borderColor} p-5 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">{result.deal_name}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatCurrency(result.amount)} · {result.stage_name} · Created {daysAgo(result.create_date)}
          </p>
          {result.owner_name && (
            <p className="text-xs text-gray-400 mt-0.5">{result.owner_name}</p>
          )}
        </div>
        <span className={`flex-shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Compliance Bars */}
      <div className="space-y-1.5 mb-3">
        <ComplianceBar
          label="Speed"
          value={speedVal}
          target={100}
          suffix={formatSpeed(metrics.speedToLeadMinutes ?? null)}
          rating={speedRating}
        />
        <ComplianceBar
          label="3-Day Calls"
          value={metrics.callsIn3BusinessDays || 0}
          target={callTarget}
        />
        <ComplianceBar
          label="5-Day Touch"
          value={metrics.touchesIn5BusinessDays || 0}
          target={touchTarget}
        />
        <ComplianceBar
          label="Nurture"
          value={nurtureVal}
          target={100}
          suffix={nurtureSuffix}
          rating={nurtureRating}
        />
        <ComplianceBar
          label="Channels"
          value={metrics.channelDiversity || 0}
          target={3}
        />
      </div>

      {/* Activity Sparkline */}
      {touchTimestamps.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400">Activity</span>
            <ActivitySparkline
              touchTimestamps={touchTimestamps}
              createDate={result.create_date}
              dealAgeDays={result.deal_age_days}
            />
          </div>
          <div className="flex items-center gap-3 mt-0.5 ml-[66px]">
            <span className="flex items-center gap-1 text-[9px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Calls
            </span>
            <span className="flex items-center gap-1 text-[9px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Emails
            </span>
          </div>
        </div>
      )}

      {/* Email Engagement */}
      {emailEng && (emailEng.totalOutboundEmails ?? 0) > 0 && (
        <div className="text-sm text-gray-500 mb-2">
          <span className="text-gray-400">Email:</span>{' '}
          {emailEng.totalOutboundEmails} sent, {emailEng.emailsOpened || 0} opened
          {openRate !== null && ` (${openRate}%)`}
          {emailEng.signal && emailEng.signal !== 'NO_DATA' && (
            <span className={`ml-1.5 text-[10px] font-medium ${
              emailEng.signal === 'ENGAGED_PASSIVE' ? 'text-green-600' :
              emailEng.signal === 'SOME_INTEREST' ? 'text-amber-600' :
              'text-gray-400'
            }`}>
              {emailEng.signal.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      )}

      {/* Risk Flags */}
      {result.engagement_risk && (
        <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 rounded-lg px-2.5 py-1.5 mb-2">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="font-medium">Engagement Risk:</span> Prospect opening emails, rep stopped calling
        </div>
      )}

      {result.risk_flag && !result.engagement_risk && (
        <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5 mb-2">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="font-medium">Risk Flag:</span> Prospect disengaged, no recent outreach
        </div>
      )}

      {/* Coaching */}
      {result.coaching && (
        <p className="text-sm text-gray-500 italic leading-relaxed">
          &ldquo;{result.coaching}&rdquo;
        </p>
      )}
    </div>
  );
}
