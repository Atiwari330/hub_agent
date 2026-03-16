import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

interface SourceStages {
  mql: number;
  sql: number;
  discovery: number;
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
    mqlToDiscovery: number;
    discoveryToDemo: number;
    demoToProposal: number;
    proposalToWon: number;
    overallWinRate: number;
  };
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
        deal_name,
        amount,
        lead_source,
        pipeline,
        hubspot_created_at,
        mql_entered_at,
        sql_entered_at,
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

    // Group by lead_source
    const sourceMap = new Map<string, typeof deals>();

    for (const deal of deals || []) {
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
          sql: 0,
          discovery: 0,
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
          if (deal.sql_entered_at) stages.sql++;
          if (deal.discovery_entered_at) stages.discovery++;
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
          mqlToDiscovery: stages.mql > 0 ? (stages.discovery / stages.mql) * 100 : 0,
          discoveryToDemo: stages.discovery > 0 ? (stages.demoCompleted / stages.discovery) * 100 : 0,
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

    const totalDeals = (deals || []).length;
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
    });
  } catch (error) {
    console.error('Lead source analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze lead sources' },
      { status: 500 }
    );
  }
}
