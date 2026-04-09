import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import type { AEExecutionSummary } from '@/lib/command-center/types';

const AE_TARGETS: Record<string, number> = {
  'cgarraffa@opusbehavioral.com': 400000,
  'jrice@opusbehavioral.com': 300000,
  'atiwari@opusbehavioral.com': 90000,
  'zclaussen@opusbehavioral.com': 90000,
  'hgomez@opusbehavioral.com': 25000,
};

const Q2_START = '2026-04-01';
const Q2_END = '2026-06-30T23:59:59';
const CLOSED_WON_ID = SALES_PIPELINE_STAGES.CLOSED_WON.id;

function computeGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch intelligence, owners, deals (for close dates), and Q2 closed-won deals
    const [intResult, ownersResult, dealsResult, closedWonResult] = await Promise.all([
      supabase
        .from('deal_intelligence')
        .select('hubspot_deal_id, owner_id, owner_name, overall_score, overall_grade, amount, stage_id')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID),
      supabase
        .from('owners')
        .select('id, first_name, last_name, email')
        .in('email', Object.keys(AE_TARGETS)),
      supabase
        .from('deals')
        .select('hubspot_deal_id, close_date, deal_stage')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID),
      supabase
        .from('deals')
        .select('hubspot_deal_id, owner_id, amount')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
        .eq('deal_stage', CLOSED_WON_ID)
        .gte('closed_won_entered_at', Q2_START)
        .lte('closed_won_entered_at', Q2_END),
    ]);

    if (intResult.error) throw new Error(`Intelligence fetch failed: ${intResult.error.message}`);

    const allIntel = intResult.data || [];
    const owners = ownersResult.data || [];
    const allDeals = dealsResult.data || [];
    const closedWonDeals = closedWonResult.data || [];
    const openStageSet = new Set(ALL_OPEN_STAGE_IDS);

    // Build close date lookup to filter to Q2-closing deals only
    const closeDateMap = new Map(allDeals.map((d) => [d.hubspot_deal_id, d.close_date]));

    // Group intelligence by owner — only include open deals closing in Q2
    const ownerIntelMap = new Map<string, typeof allIntel>();
    for (const row of allIntel) {
      if (!row.owner_id) continue;
      if (!openStageSet.has(row.stage_id || '')) continue;
      // Only include deals with close date in Q2 (or no close date, assumed Q2)
      const closeDate = closeDateMap.get(row.hubspot_deal_id);
      if (closeDate && (closeDate < Q2_START || closeDate > '2026-06-30')) continue;
      const list = ownerIntelMap.get(row.owner_id) || [];
      list.push(row);
      ownerIntelMap.set(row.owner_id, list);
    }

    // Closed-won ARR by owner
    const closedWonByOwner = new Map<string, number>();
    for (const d of closedWonDeals) {
      if (!d.owner_id) continue;
      closedWonByOwner.set(d.owner_id, (closedWonByOwner.get(d.owner_id) || 0) + (Number(d.amount) || 0));
    }

    const aeExecutions: AEExecutionSummary[] = [];

    for (const [email, target] of Object.entries(AE_TARGETS)) {
      const owner = owners.find((o) => o.email === email);
      const ownerId = owner?.id || null;
      const name = owner
        ? [owner.first_name, owner.last_name].filter(Boolean).join(' ')
        : email.split('@')[0];

      const deals = ownerId ? ownerIntelMap.get(ownerId) || [] : [];
      const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      let totalScore = 0;

      for (const d of deals) {
        const g = d.overall_grade as keyof typeof gradeDist;
        if (g in gradeDist) gradeDist[g]++;
        totalScore += d.overall_score;
      }

      const avgScore = deals.length > 0 ? Math.round(totalScore / deals.length) : 0;
      const pipelineARR = deals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      const closedWonARR = ownerId ? closedWonByOwner.get(ownerId) || 0 : 0;

      aeExecutions.push({
        name,
        email,
        ownerId,
        q2Target: target,
        closedWonARR,
        pipelineARR,
        dealCount: deals.length,
        avgGrade: computeGrade(avgScore),
        gradeDistribution: gradeDist,
        dealsNeedingAttention: gradeDist.D + gradeDist.F,
        avgScore,
      });
    }

    // Sort by target descending
    aeExecutions.sort((a, b) => b.q2Target - a.q2Target);

    return NextResponse.json({ aeExecutions });
  } catch (error) {
    console.error('AE execution error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch AE execution data' },
      { status: 500 },
    );
  }
}
