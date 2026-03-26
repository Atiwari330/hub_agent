'use client';

interface BriefingSection {
  summary_json: Record<string, unknown> | null;
  status: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function StatCard({
  title,
  stats,
  accentColor,
}: {
  title: string;
  stats: { label: string; value: string | number; highlight?: boolean }[];
  accentColor: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className={`text-sm font-medium ${accentColor} mb-3`}>{title}</h3>
      <div className="space-y-2">
        {stats.map((stat, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-sm text-gray-500">{stat.label}</span>
            <span className={`text-sm font-semibold ${stat.highlight ? 'text-red-600' : 'text-gray-900'}`}>
              {stat.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BriefingSummaryBar({
  dealScrubSections,
  pplCadenceSection,
  ticketTriageSection,
}: {
  dealScrubSections: BriefingSection[];
  pplCadenceSection: BriefingSection | null;
  ticketTriageSection: BriefingSection | null;
}) {
  // Aggregate deal scrub summaries
  let totalDeals = 0;
  let totalValue = 0;
  let atRiskValue = 0;

  for (const section of dealScrubSections) {
    if (section.status === 'completed' && section.summary_json) {
      const s = section.summary_json as {
        totalDeals?: number;
        totalValue?: number;
        atRiskValue?: number;
      };
      totalDeals += s.totalDeals || 0;
      totalValue += s.totalValue || 0;
      atRiskValue += s.atRiskValue || 0;
    }
  }

  // PPL summary
  const pplSummary = pplCadenceSection?.status === 'completed' && pplCadenceSection.summary_json
    ? (pplCadenceSection.summary_json as {
        totalDeals?: number;
        byVerdict?: Record<string, number>;
        riskCount?: number;
        engagementRiskCount?: number;
      })
    : null;

  const pplCompliant = (pplSummary?.byVerdict?.['COMPLIANT'] || 0) + (pplSummary?.byVerdict?.['EXEMPLARY'] || 0);
  const pplNeedsWork = (pplSummary?.byVerdict?.['NEEDS_IMPROVEMENT'] || 0) + (pplSummary?.byVerdict?.['NON_COMPLIANT'] || 0);

  // Triage summary
  const triageSummary = ticketTriageSection?.status === 'completed' && ticketTriageSection.summary_json
    ? (ticketTriageSection.summary_json as {
        total?: number;
        immediateCount?: number;
        byStatus?: Record<string, number>;
      })
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard
        title="Pipeline"
        accentColor="text-indigo-600"
        stats={[
          { label: 'Total value', value: formatCurrency(totalValue) },
          { label: 'Open deals', value: totalDeals },
          { label: 'At risk', value: formatCurrency(atRiskValue), highlight: atRiskValue > 0 },
        ]}
      />
      <StatCard
        title="PPL Cadence"
        accentColor="text-violet-600"
        stats={pplSummary
          ? [
              { label: 'PPL deals', value: pplSummary.totalDeals || 0 },
              { label: 'Compliant', value: pplCompliant },
              { label: 'Need improvement', value: pplNeedsWork, highlight: pplNeedsWork > 0 },
            ]
          : [{ label: 'Status', value: pplCadenceSection?.status || 'No data' }]
        }
      />
      <StatCard
        title="Support"
        accentColor="text-teal-600"
        stats={triageSummary
          ? [
              { label: 'Open tickets', value: triageSummary.total || 0 },
              { label: 'Need immediate action', value: triageSummary.immediateCount || 0, highlight: (triageSummary.immediateCount || 0) > 0 },
              { label: 'Agent action needed', value: triageSummary.byStatus?.['AGENT_ACTION_NEEDED'] || 0 },
            ]
          : [{ label: 'Status', value: ticketTriageSection?.status || 'No data' }]
        }
      />
    </div>
  );
}
