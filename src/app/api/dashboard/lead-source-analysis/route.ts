import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';

// Current pipeline stages in order (excluding legacy SQL)
const STAGE_ORDER = [
  { key: 'mql', id: SALES_PIPELINE_STAGES.MQL.id, label: 'MQL' },
  { key: 'sqlDiscovery', id: SALES_PIPELINE_STAGES.SQL_DISCOVERY.id, label: 'SQL/Discovery' },
  { key: 'demoScheduled', id: SALES_PIPELINE_STAGES.DEMO_SCHEDULED.id, label: 'Demo Scheduled' },
  { key: 'demoCompleted', id: SALES_PIPELINE_STAGES.DEMO_COMPLETED.id, label: 'Demo Completed' },
  { key: 'qualifiedValidated', id: SALES_PIPELINE_STAGES.QUALIFIED_VALIDATED.id, label: 'Qualified/Validated' },
  { key: 'proposalEvaluating', id: SALES_PIPELINE_STAGES.PROPOSAL_EVALUATING.id, label: 'Proposal/Evaluating' },
  { key: 'msaSentReview', id: SALES_PIPELINE_STAGES.MSA_SENT_REVIEW.id, label: 'MSA Sent/Review' },
  { key: 'closedWon', id: SALES_PIPELINE_STAGES.CLOSED_WON.id, label: 'Closed Won' },
  { key: 'closedLost', id: SALES_PIPELINE_STAGES.CLOSED_LOST.id, label: 'Closed Lost' },
] as const;

// Build stage ID → key map
const STAGE_ID_TO_KEY = new Map<string, string>();
for (const s of STAGE_ORDER) {
  STAGE_ID_TO_KEY.set(s.id, s.key);
}
// Also map legacy SQL to sqlDiscovery
STAGE_ID_TO_KEY.set(SALES_PIPELINE_STAGES.SQL_LEGACY.id, 'sqlDiscovery');

type StageCounts = Record<string, number>;

interface SourceSummary {
  leadSource: string;
  totalDeals: number;
  totalAmount: number;
  stages: StageCounts;
  closedWonAmount: number;
  winRate: number;
}

interface TrendWeek {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  sources: Record<string, number>;
  total: number;
}

interface DealRecord {
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  leadSource: string;
  ownerName: string;
  hubspotCreatedAt: string;
  currentStage: string;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(monday: Date): string {
  const month = monday.toLocaleDateString('en-US', { month: 'short' });
  const day = monday.getDate();
  return `${month} ${day}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || '2026-01-01';
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

    const supabase = createServiceClient();

    const { data: deals, error } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        close_date,
        lead_source,
        pipeline,
        deal_stage,
        hubspot_created_at,
        hubspot_owner_id
      `)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .gte('hubspot_created_at', `${startDate}T00:00:00`)
      .lte('hubspot_created_at', `${endDate}T23:59:59.999`);

    if (error) {
      console.error('Lead source analysis query error:', error);
      return NextResponse.json({ error: 'Failed to query deals' }, { status: 500 });
    }

    // Fetch owners for name lookup
    const { data: owners } = await supabase
      .from('owners')
      .select('hubspot_owner_id, first_name, last_name');

    const ownerMap = new Map<string, string>();
    for (const o of owners || []) {
      const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || 'Unknown';
      ownerMap.set(o.hubspot_owner_id, name);
    }

    const allDeals = deals || [];

    // Map stage IDs to labels for deal records
    const stageIdToLabel = new Map<string, string>();
    for (const s of STAGE_ORDER) {
      stageIdToLabel.set(s.id, s.label);
    }
    stageIdToLabel.set(SALES_PIPELINE_STAGES.SQL_LEGACY.id, 'SQL/Discovery');

    // Build deal records for drill-down
    const dealRecords: DealRecord[] = allDeals.map((deal) => ({
      hubspotDealId: deal.hubspot_deal_id,
      dealName: deal.deal_name || 'Untitled Deal',
      amount: deal.amount ? Number(deal.amount) : null,
      closeDate: deal.close_date || null,
      leadSource: deal.lead_source || 'Unknown',
      ownerName: ownerMap.get(deal.hubspot_owner_id || '') || 'Unassigned',
      hubspotCreatedAt: deal.hubspot_created_at || '',
      currentStage: stageIdToLabel.get(deal.deal_stage || '') || 'Unknown',
    }));

    // Build trend data (weekly buckets)
    const weekMap = new Map<string, TrendWeek>();

    for (const deal of allDeals) {
      if (!deal.hubspot_created_at) continue;
      const createdAt = new Date(deal.hubspot_created_at);
      const monday = getMonday(createdAt);
      const key = monday.toISOString().split('T')[0];
      const source = deal.lead_source || 'Unknown';

      if (!weekMap.has(key)) {
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        weekMap.set(key, {
          weekStart: key,
          weekEnd: sunday.toISOString().split('T')[0],
          weekLabel: formatWeekLabel(monday),
          sources: {},
          total: 0,
        });
      }

      const week = weekMap.get(key)!;
      week.sources[source] = (week.sources[source] || 0) + 1;
      week.total++;
    }

    const trend = Array.from(weekMap.values()).sort(
      (a, b) => a.weekStart.localeCompare(b.weekStart)
    );

    // Group by lead_source and count current stages
    const sourceMap = new Map<string, typeof allDeals>();

    for (const deal of allDeals) {
      const source = deal.lead_source || 'Unknown';
      if (!sourceMap.has(source)) {
        sourceMap.set(source, []);
      }
      sourceMap.get(source)!.push(deal);
    }

    const sources: SourceSummary[] = Array.from(sourceMap.entries())
      .map(([leadSource, sourceDeals]) => {
        const stages: StageCounts = {};
        for (const s of STAGE_ORDER) {
          stages[s.key] = 0;
        }

        let totalAmount = 0;
        let closedWonAmount = 0;

        for (const deal of sourceDeals) {
          const amt = Number(deal.amount) || 0;
          totalAmount += amt;

          const stageKey = STAGE_ID_TO_KEY.get(deal.deal_stage || '') || 'unknown';
          if (stageKey in stages) {
            stages[stageKey]++;
          }

          if (deal.deal_stage === SALES_PIPELINE_STAGES.CLOSED_WON.id) {
            closedWonAmount += amt;
          }
        }

        const total = sourceDeals.length;
        const closedWonCount = stages['closedWon'] || 0;

        return {
          leadSource,
          totalDeals: total,
          totalAmount,
          stages,
          closedWonAmount,
          winRate: total > 0 ? (closedWonCount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalDeals - a.totalDeals);

    const totalDeals = allDeals.length;
    const totalClosedWon = sources.reduce((sum, s) => sum + (s.stages['closedWon'] || 0), 0);
    const totalAmount = sources.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalClosedWonAmount = sources.reduce((sum, s) => sum + s.closedWonAmount, 0);
    const overallWinRate = totalDeals > 0 ? (totalClosedWon / totalDeals) * 100 : 0;

    return NextResponse.json({
      dateRange: { startDate, endDate },
      totalDeals,
      totalClosedWon,
      totalAmount,
      totalClosedWonAmount,
      overallWinRate,
      sources,
      trend,
      deals: dealRecords,
      stageOrder: STAGE_ORDER.map((s) => ({ key: s.key, label: s.label })),
    });
  } catch (error) {
    console.error('Lead source analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze lead sources' },
      { status: 500 }
    );
  }
}
