'use client';

interface TriageResult {
  ticketId: string;
  subject: string;
  company: string;
  rep: string;
  ageDays: number;
  priority: string;
  isCoDestiny: boolean;
  hasLinear: boolean;
  status: string;
  confidence: string;
  statusRationale: string;
  nextStep: string;
  urgency: string;
  error?: string;
}

interface BriefingSection {
  id: string;
  status: string;
  results_json: unknown[] | null;
  summary_json: Record<string, unknown> | null;
  error: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  AGENT_ACTION_NEEDED: 'Agent Action Needed',
  WAITING_ON_CUSTOMER: 'Waiting on Customer',
  WAITING_ON_ENGINEERING: 'Waiting on Engineering',
  ENGINEERING_FOLLOWUP_NEEDED: 'Engineering Followup Needed',
  CLARIFICATION_NEEDED_FROM_LINEAR: 'Clarification Needed from Linear',
  READY_TO_CLOSE: 'Ready to Close',
  STALE: 'Stale',
  UNKNOWN: 'Unknown',
};

const STATUS_COLORS: Record<string, string> = {
  AGENT_ACTION_NEEDED: 'bg-red-100 text-red-800 border-red-200',
  ENGINEERING_FOLLOWUP_NEEDED: 'bg-orange-100 text-orange-800 border-orange-200',
  CLARIFICATION_NEEDED_FROM_LINEAR: 'bg-amber-100 text-amber-800 border-amber-200',
  STALE: 'bg-amber-100 text-amber-800 border-amber-200',
  WAITING_ON_ENGINEERING: 'bg-blue-100 text-blue-800 border-blue-200',
  WAITING_ON_CUSTOMER: 'bg-slate-100 text-slate-800 border-slate-200',
  READY_TO_CLOSE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
};

const URGENCY_COLORS: Record<string, string> = {
  IMMEDIATE: 'bg-red-600 text-white',
  TODAY: 'bg-orange-100 text-orange-800',
  THIS_WEEK: 'bg-blue-100 text-blue-800',
  LOW: 'bg-gray-100 text-gray-600',
};

const STATUS_ORDER = [
  'AGENT_ACTION_NEEDED',
  'ENGINEERING_FOLLOWUP_NEEDED',
  'CLARIFICATION_NEEDED_FROM_LINEAR',
  'STALE',
  'WAITING_ON_ENGINEERING',
  'WAITING_ON_CUSTOMER',
  'READY_TO_CLOSE',
  'UNKNOWN',
];

const URGENCY_ORDER = ['IMMEDIATE', 'TODAY', 'THIS_WEEK', 'LOW'];

function TicketCard({ result }: { result: TriageResult }) {
  if (result.error) {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <div className="font-medium text-red-900">#{result.ticketId} — {result.subject}</div>
        <div className="text-sm text-red-700 mt-1">Error: {result.error}</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900 truncate">{result.subject}</h4>
            {result.isCoDestiny && (
              <span className="px-1.5 py-0.5 text-xs font-bold bg-purple-600 text-white rounded">VIP</span>
            )}
            {result.hasLinear && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded">Linear</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {result.company} | Rep: {result.rep} | {result.ageDays}d old
          </p>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-bold rounded ${URGENCY_COLORS[result.urgency] || URGENCY_COLORS.LOW}`}>
          {result.urgency}
        </span>
      </div>

      <div className="text-sm bg-gray-50 rounded-lg p-3 border-l-3 border-gray-300">
        {result.nextStep}
      </div>
    </div>
  );
}

export function TicketTriageSection({ section }: { section: BriefingSection | null }) {
  if (!section) {
    return (
      <div className="text-center py-12 text-gray-500">
        No ticket triage data available for this briefing.
      </div>
    );
  }

  if (section.status === 'failed') {
    return (
      <div className="bg-red-50 rounded-xl border border-red-200 p-5">
        <h3 className="font-semibold text-red-900">Ticket Triage Failed</h3>
        <p className="text-sm text-red-700 mt-1">{section.error}</p>
      </div>
    );
  }

  if (section.status === 'pending' || section.status === 'running') {
    return (
      <div className="text-center py-12 text-gray-500">
        Ticket triage is {section.status}...
      </div>
    );
  }

  const results = (section.results_json || []) as TriageResult[];

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No open tickets found.
      </div>
    );
  }

  // Sort by status order, then urgency
  const sorted = [...results].filter((r) => !r.error).sort((a, b) => {
    const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;
    const urgencyDiff = URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency);
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.ageDays - a.ageDays;
  });

  const errors = results.filter((r) => r.error);

  // Group by status
  const groups: Record<string, TriageResult[]> = {};
  for (const r of sorted) {
    if (!groups[r.status]) groups[r.status] = [];
    groups[r.status].push(r);
  }

  return (
    <div className="space-y-6">
      {STATUS_ORDER.filter((s) => groups[s]).map((status) => (
        <div key={status}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${STATUS_COLORS[status]}`}>
              {STATUS_LABELS[status]}
            </span>
            <span className="text-sm text-gray-400">
              {groups[status].length} ticket{groups[status].length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-3">
            {groups[status].map((result) => (
              <TicketCard key={result.ticketId} result={result} />
            ))}
          </div>
        </div>
      ))}

      {errors.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-red-600">Errors ({errors.length})</span>
          </div>
          <div className="space-y-3">
            {errors.map((result) => (
              <TicketCard key={result.ticketId} result={result} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
