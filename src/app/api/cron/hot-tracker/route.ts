import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { computeHotTrackerForQuarter } from '@/lib/hot-tracker/compute';
import { getCurrentQuarter } from '@/lib/utils/quarter';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    const startTime = Date.now();

    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'hot-tracker',
      status: 'running',
    });

    // Parse optional year/quarter from query params (default: current quarter)
    const url = new URL(request.url);
    const currentQ = getCurrentQuarter();
    const year = parseInt(url.searchParams.get('year') || String(currentQ.year));
    const quarter = parseInt(url.searchParams.get('quarter') || String(currentQ.quarter));

    console.log(`[hot-tracker] Computing metrics for Q${quarter} ${year}...`);

    const result = await computeHotTrackerForQuarter(year, quarter);

    // Upsert team totals (owner_id IS NULL — can't use standard upsert with NULLs)
    // Delete existing team rows for this quarter, then insert fresh
    await supabase
      .from('hot_tracker_snapshots')
      .delete()
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .is('owner_id', null);

    for (const week of result.teamWeeks) {
      await supabase
        .from('hot_tracker_snapshots')
        .insert({
          fiscal_year: year,
          fiscal_quarter: quarter,
          week_number: week.weekNumber,
          week_start: week.weekStart,
          week_end: week.weekEnd,
          owner_id: null,
          hubspot_owner_id: null,
          sql_deals_count: week.sqlDealsCount,
          sql_contacted_15min: week.sqlContacted15min,
          sql_deal_details: week.sqlDealDetails,
          calls_to_sql_with_phone: week.callsToSqlWithPhone,
          proposal_deals_count: week.proposalDealsCount,
          proposal_deals_with_gift: week.proposalDealsWithGift,
          computed_at: new Date().toISOString(),
        });
    }

    // Upsert per-owner rows
    for (const [ownerId, ownerWeeks] of result.byOwner) {
      for (const week of ownerWeeks) {
        await supabase
          .from('hot_tracker_snapshots')
          .upsert(
            {
              fiscal_year: year,
              fiscal_quarter: quarter,
              week_number: week.weekNumber,
              week_start: week.weekStart,
              week_end: week.weekEnd,
              owner_id: ownerId,
              hubspot_owner_id: week.hubspotOwnerId,
              sql_deals_count: week.sqlDealsCount,
              sql_contacted_15min: week.sqlContacted15min,
              sql_deal_details: week.sqlDealDetails,
              calls_to_sql_with_phone: week.callsToSqlWithPhone,
              proposal_deals_count: week.proposalDealsCount,
              proposal_deals_with_gift: week.proposalDealsWithGift,
              computed_at: new Date().toISOString(),
            },
            {
              onConflict: 'fiscal_year,fiscal_quarter,week_number,owner_id',
              ignoreDuplicates: false,
            }
          );
      }
    }

    const duration = Date.now() - startTime;

    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        fiscalYear: year,
        fiscalQuarter: quarter,
        teamWeeks: result.teamWeeks.length,
        aeCount: result.byOwner.size,
        durationMs: duration,
      },
    }).eq('id', workflowId);

    console.log(`[hot-tracker] Complete in ${duration}ms: ${result.teamWeeks.length} weeks, ${result.byOwner.size} AEs`);

    return NextResponse.json({
      success: true,
      fiscalYear: year,
      fiscalQuarter: quarter,
      teamWeeks: result.teamWeeks.length,
      aeCount: result.byOwner.size,
      durationMs: duration,
    });
  } catch (error) {
    console.error('[hot-tracker] Failed:', error);

    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Hot tracker computation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
