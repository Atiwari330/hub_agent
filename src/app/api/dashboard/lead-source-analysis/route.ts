import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

interface SourceStages {
  mql: number;
  sqlDiscovery: number;
  demoScheduled: number;
  demoCompleted: number;
  proposal: number;
  closedWon: number;
}

interface SourceSummary {
  leadSource: string;
  totalDeals: number;
  totalAmount: number;
  stages: SourceStages;
  closedWonAmount: number;
  conversionRates: {
    mqlToSqlDiscovery: number;
    sqlDiscoveryToDemo: number;
    demoToProposal: number;
    proposalToWon: number;
    overallWinRate: number;
  };
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
  stages: {
    mql: string | null;
    sqlDiscovery: string | null;
    demoScheduled: string | null;
    demoCompleted: string | null;
    proposal: string | null;
    closedWon: string | null;
  };
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

    // Fetch deals with owner info
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
        hubspot_created_at,
        hubspot_owner_id,
        mql_entered_at,
        discovery_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        proposal_entered_at,
        closed_won_entered_at
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

    // Build deal records for drill-down
    const dealRecords: DealRecord[] = allDeals.map((deal) => ({
      hubspotDealId: deal.hubspot_deal_id,
      dealName: deal.deal_name || 'Untitled Deal',
      amount: deal.amount ? Number(deal.amount) : null,
      closeDate: deal.close_date || null,
      leadSource: deal.lead_source || 'Unknown',
      ownerName: ownerMap.get(deal.hubspot_owner_id || '') || 'Unassigned',
      hubspotCreatedAt: deal.hubspot_created_at || '',
      stages: {
        mql: deal.mql_entered_at || null,
        sqlDiscovery: deal.discovery_entered_at || null,
        demoScheduled: deal.demo_scheduled_entered_at || null,
        demoCompleted: deal.demo_completed_entered_at || null,
        proposal: deal.proposal_entered_at || null,
        closedWon: deal.closed_won_entered_at || null,
      },
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

    // Group by lead_source for aggregation
    const sourceMap = new Map<string, typeof allDeals>();

    for (const deal of allDeals) {
      const source = deal.lead_source || 'Unknown';
      if (!sourceMap.has(source)) {
        sourceMap.set(source, []);
      }
      sourceMap.get(source)!.push(deal);
    }

    // Aggregate per source
    const sources: SourceSummary[] = Array.from(sourceMap.entries())
      .map(([leadSource, sourceDeals]) => {
        const stages: SourceStages = {
          mql: 0,
          sqlDiscovery: 0,
          demoScheduled: 0,
          demoCompleted: 0,
          proposal: 0,
          closedWon: 0,
        };

        let totalAmount = 0;
        let closedWonAmount = 0;

        for (const deal of sourceDeals) {
          const amt = Number(deal.amount) || 0;
          totalAmount += amt;

          if (deal.mql_entered_at) stages.mql++;
          if (deal.discovery_entered_at) stages.sqlDiscovery++;
          if (deal.demo_scheduled_entered_at) stages.demoScheduled++;
          if (deal.demo_completed_entered_at) stages.demoCompleted++;
          if (deal.proposal_entered_at) stages.proposal++;
          if (deal.closed_won_entered_at) {
            stages.closedWon++;
            closedWonAmount += amt;
          }
        }

        const total = sourceDeals.length;
        const conversionRates = {
          mqlToSqlDiscovery: stages.mql > 0 ? (stages.sqlDiscovery / stages.mql) * 100 : 0,
          sqlDiscoveryToDemo: stages.sqlDiscovery > 0 ? (stages.demoCompleted / stages.sqlDiscovery) * 100 : 0,
          demoToProposal: stages.demoCompleted > 0 ? (stages.proposal / stages.demoCompleted) * 100 : 0,
          proposalToWon: stages.proposal > 0 ? (stages.closedWon / stages.proposal) * 100 : 0,
          overallWinRate: total > 0 ? (stages.closedWon / total) * 100 : 0,
        };

        return {
          leadSource,
          totalDeals: total,
          totalAmount,
          stages,
          closedWonAmount,
          conversionRates,
        };
      })
      .sort((a, b) => b.totalDeals - a.totalDeals);

    const totalDeals = allDeals.length;
    const totalClosedWon = sources.reduce((sum, s) => sum + s.stages.closedWon, 0);
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
    });
  } catch (error) {
    console.error('Lead source analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze lead sources' },
      { status: 500 }
    );
  }
}
