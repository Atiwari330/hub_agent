/**
 * Initiative tracking computation.
 *
 * Queries strategic_initiatives from Supabase, then counts deals
 * matching each initiative's lead_source values in Q2.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import type { InitiativeStatus } from './types';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CLOSED_WON_STAGE_ID = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';

export async function computeInitiativeStatus(supabase: SupabaseClient): Promise<InitiativeStatus[]> {
  const q2 = getQuarterInfo(2026, 2);
  const progress = getQuarterProgress(q2);
  const currentWeek = Math.min(13, Math.ceil(progress.daysElapsed / 7));
  const q2Start = q2.startDate;

  // Fetch initiatives
  const { data: initiatives, error: initError } = await supabase
    .from('strategic_initiatives')
    .select('*')
    .eq('is_active', true);

  if (initError) throw new Error(`Failed to fetch initiatives: ${initError.message}`);
  if (!initiatives || initiatives.length === 0) return [];

  // Fetch all Q2 deals with lead sources
  const { data: deals, error: dealError } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, hubspot_created_at, closed_won_entered_at, deal_stage')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', q2.startDate.toISOString())
    .lte('hubspot_created_at', q2.endDate.toISOString());

  if (dealError) throw new Error(`Failed to fetch deals: ${dealError.message}`);
  const allDeals = deals || [];

  return initiatives.map((init) => {
    const matchingDeals = allDeals.filter((d) =>
      d.lead_source && init.lead_source_values.includes(d.lead_source)
    );

    const closedWonDeals = matchingDeals.filter((d) =>
      d.deal_stage === CLOSED_WON_STAGE_ID || d.closed_won_entered_at
    );

    // Weekly breakdown
    const weekly = new Array(13).fill(0);
    for (const d of matchingDeals) {
      if (d.hubspot_created_at) {
        const weekIdx = Math.floor((new Date(d.hubspot_created_at).getTime() - q2Start.getTime()) / (7 * 86400000));
        if (weekIdx >= 0 && weekIdx < 13) weekly[weekIdx]++;
      }
    }

    const expectedByNow = (init.weekly_lead_pace || 0) * currentWeek;
    let paceStatus: 'ahead' | 'on_pace' | 'behind' = 'on_pace';
    if (matchingDeals.length > expectedByNow * 1.1) paceStatus = 'ahead';
    else if (matchingDeals.length < expectedByNow * 0.9) paceStatus = 'behind';

    return {
      id: init.id,
      name: init.name,
      ownerLabel: init.owner_label || '',
      leadSourceValues: init.lead_source_values,
      q2LeadTarget: init.q2_lead_target || 0,
      q2ArrTarget: Number(init.q2_arr_target) || 0,
      weeklyLeadPace: init.weekly_lead_pace || 0,
      leadsCreated: matchingDeals.length,
      arrGenerated: matchingDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      closedWonARR: closedWonDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      expectedByNow,
      paceStatus,
      weeklyBreakdown: weekly,
    };
  });
}
