'use client';

interface CadenceResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  closeDate: string | null;
  createDate: string;
  dealAgeDays: number;
  metrics: {
    speedToLeadMinutes: number | null;
    speedToLeadRating: string;
    callsIn3BusinessDays: number;
    touchesIn5BusinessDays: number;
    channelsUsed: string[];
    channelDiversity: number;
    postWeek1TouchesPerWeek: number | null;
    postWeek1Assessment: string;
    totalFollowUpAttempts: number;
    totalCallAttempts: number;
    totalOutboundEmails: number;
    meetingBooked: boolean;
    meetingBookedDate: string | null;
    emailEngagement: {
      totalOutboundEmails: number;
      emailsOpened: number;
      openRate: number;
      signal: string;
      nurtureWindowWeeks: number;
    };
  };
  threeCompliance: string;
  twoCompliance: string;
  oneCompliance: string;
  speedRating: string;
  channelDiversityRating: string;
  prospectEngagement: string;
  nurtureWindow: string;
  engagementInsight: string;
  verdict: string;
  coaching: string;
  riskFlag: boolean;
  engagementRisk: boolean;
  executiveSummary: string;
  error?: string;
}

interface BriefingSection {
  id: string;
  status: string;
  results_json: unknown[] | null;
  summary_json: Record<string, unknown> | null;
  error: string | null;
}

function formatSpeed(minutes: number | null): string {
  if (minutes === null) return 'NO CALL';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const VERDICT_COLORS: Record<string, string> = {
  NON_COMPLIANT: 'bg-red-100 text-red-800 ring-red-200',
  NEEDS_IMPROVEMENT: 'bg-orange-100 text-orange-800 ring-orange-200',
  COMPLIANT: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  EXEMPLARY: 'bg-green-100 text-green-800 ring-green-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const VERDICT_LABELS: Record<string, string> = {
  NON_COMPLIANT: 'Non-Compliant',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
  COMPLIANT: 'Compliant',
  EXEMPLARY: 'Exemplary',
  UNKNOWN: 'Unknown',
};

const COMPLIANCE_COLORS: Record<string, string> = {
  COMPLIANT: 'text-emerald-700 bg-emerald-50',
  PARTIAL: 'text-amber-700 bg-amber-50',
  NON_COMPLIANT: 'text-red-700 bg-red-50',
  TOO_EARLY: 'text-gray-500 bg-gray-50',
  UNKNOWN: 'text-gray-500 bg-gray-50',
};

const VERDICT_ORDER = ['NON_COMPLIANT', 'NEEDS_IMPROVEMENT', 'COMPLIANT', 'EXEMPLARY', 'UNKNOWN'];

function CadenceCard({ result }: { result: CadenceResult }) {
  if (result.error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <div className="font-medium text-red-900">{result.dealName}</div>
        <div className="text-sm text-red-700 mt-1">Error: {result.error}</div>
      </div>
    );
  }

  const m = result.metrics;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900">{result.dealName}</h4>
            {result.riskFlag && (
              <span className="px-1.5 py-0.5 text-xs font-bold bg-red-600 text-white rounded">RISK</span>
            )}
            {result.engagementRisk && (
              <span className="px-1.5 py-0.5 text-xs font-bold bg-orange-600 text-white rounded">ENG RISK</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {result.ownerName} | {result.dealAgeDays}d old | Created {result.createDate.split('T')[0]}
          </p>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ring-1 whitespace-nowrap ${VERDICT_COLORS[result.verdict] || VERDICT_COLORS.UNKNOWN}`}>
          {VERDICT_LABELS[result.verdict] || result.verdict}
        </span>
      </div>

      {/* 3-2-1 Scores */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className={`rounded-lg p-2.5 text-center ${COMPLIANCE_COLORS[result.threeCompliance] || COMPLIANCE_COLORS.UNKNOWN}`}>
          <div className="text-xs font-medium opacity-70">THREE</div>
          <div className="text-sm font-bold">{m?.callsIn3BusinessDays ?? '?'}/6 calls</div>
          <div className="text-xs">{result.threeCompliance}</div>
        </div>
        <div className={`rounded-lg p-2.5 text-center ${COMPLIANCE_COLORS[result.twoCompliance] || COMPLIANCE_COLORS.UNKNOWN}`}>
          <div className="text-xs font-medium opacity-70">TWO</div>
          <div className="text-sm font-bold">{m?.touchesIn5BusinessDays ?? '?'}/6 touches</div>
          <div className="text-xs">{result.twoCompliance}</div>
        </div>
        <div className={`rounded-lg p-2.5 text-center ${COMPLIANCE_COLORS[result.oneCompliance] || COMPLIANCE_COLORS.UNKNOWN}`}>
          <div className="text-xs font-medium opacity-70">ONE</div>
          <div className="text-sm font-bold">
            {m?.postWeek1TouchesPerWeek !== null && m?.postWeek1TouchesPerWeek !== undefined
              ? `${m.postWeek1TouchesPerWeek.toFixed(1)}/wk`
              : 'N/A'}
          </div>
          <div className="text-xs">{result.oneCompliance}</div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="text-sm text-gray-600 mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>Speed: <strong>{formatSpeed(m?.speedToLeadMinutes ?? null)}</strong></span>
        <span>Channels: <strong>{m?.channelsUsed?.join(', ') || 'None'}</strong></span>
        {m?.meetingBooked && (
          <span className="text-emerald-600 font-medium">Meeting booked</span>
        )}
        {m?.emailEngagement?.totalOutboundEmails > 0 && (
          <span>
            Email: <strong>{m.emailEngagement.emailsOpened}/{m.emailEngagement.totalOutboundEmails} opened</strong>
            <span className="text-gray-400"> ({result.prospectEngagement})</span>
          </span>
        )}
      </div>

      {/* Coaching point */}
      <div className="text-sm bg-gray-50 rounded-lg p-3 border-l-3 border-gray-300 mb-2">
        <span className="font-medium text-gray-700">Coaching: </span>
        {result.coaching}
      </div>

      {/* Executive summary */}
      <p className="text-sm text-gray-600 italic">{result.executiveSummary}</p>

      {/* Engagement insight */}
      {result.engagementInsight && result.engagementInsight !== 'UNKNOWN' && (
        <p className="text-xs text-violet-600 mt-2">
          Email insight: {result.engagementInsight}
        </p>
      )}
    </div>
  );
}

export function PplCadenceSection({ section }: { section: BriefingSection | null }) {
  if (!section) {
    return (
      <div className="text-center py-12 text-gray-500">
        No PPL cadence data available for this briefing.
      </div>
    );
  }

  if (section.status === 'failed') {
    return (
      <div className="bg-red-50 rounded-xl border border-red-200 p-5">
        <h3 className="font-semibold text-red-900">PPL Cadence Analysis Failed</h3>
        <p className="text-sm text-red-700 mt-1">{section.error}</p>
      </div>
    );
  }

  if (section.status === 'pending' || section.status === 'running') {
    return (
      <div className="text-center py-12 text-gray-500">
        PPL cadence analysis is {section.status}...
      </div>
    );
  }

  const results = (section.results_json || []) as CadenceResult[];

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No PPL deals found for analysis.
      </div>
    );
  }

  // Sort by verdict (worst first)
  const sorted = [...results].sort((a, b) => {
    const aIdx = VERDICT_ORDER.indexOf(a.verdict);
    const bIdx = VERDICT_ORDER.indexOf(b.verdict);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (b.amount || 0) - (a.amount || 0);
  });

  // Group by verdict
  const groups: Record<string, CadenceResult[]> = {};
  for (const r of sorted) {
    if (!groups[r.verdict]) groups[r.verdict] = [];
    groups[r.verdict].push(r);
  }

  return (
    <div className="space-y-6">
      {VERDICT_ORDER.filter((v) => groups[v]).map((verdict) => (
        <div key={verdict}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ring-1 ${VERDICT_COLORS[verdict]}`}>
              {VERDICT_LABELS[verdict]}
            </span>
            <span className="text-sm text-gray-400">
              {groups[verdict].length} deal{groups[verdict].length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-4">
            {groups[verdict].map((result) => (
              <CadenceCard key={result.dealId} result={result} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
