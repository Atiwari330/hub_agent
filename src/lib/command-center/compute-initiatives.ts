/**
 * Initiative tracking computation.
 *
 * Queries strategic_initiatives from Supabase, then counts deals
 * matching each initiative's lead_source + lead_source_detail values in Q2.
 *
 * Matching logic:
 * - If initiative has lead_source_detail_values: match source AND detail
 * - If initiative has only lead_source_values: match source, EXCLUDE deals
 *   that match any other initiative's detail values (prevents double-counting)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import { getQuarterWeeksSunSat } from '@/lib/utils/weeks';
import type { InitiativeStatus } from './types';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CLOSED_WON_STAGE_ID = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';

export async function computeInitiativeStatus(supabase: SupabaseClient): Promise<InitiativeStatus[]> {
  const q2 = getQuarterInfo(2026, 2);
  const progress = getQuarterProgress(q2);
  const weeks = getQuarterWeeksSunSat(q2);
  // Fractional weeks elapsed — decouples expected-by-now math from
  // whether we're mid-week, and handles partial first/last weeks cleanly.
  const weeksElapsed = (progress.daysElapsed / progress.totalDays) * weeks.length;

  // Fetch initiatives
  const { data: initiatives, error: initError } = await supabase
    .from('strategic_initiatives')
    .select('*')
    .eq('is_active', true);

  if (initError) throw new Error(`Failed to fetch initiatives: ${initError.message}`);
  if (!initiatives || initiatives.length === 0) return [];

  // Fetch all Q2 deals with lead sources and detail
  const { data: deals, error: dealError } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, lead_source_detail, hubspot_created_at, closed_won_entered_at, deal_stage')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', q2.startDate.toISOString())
    .lte('hubspot_created_at', q2.endDate.toISOString());

  if (dealError) throw new Error(`Failed to fetch deals: ${dealError.message}`);
  const allDeals = deals || [];

  // Collect all detail values that have specific initiative matches
  // (used to exclude from catch-all initiatives)
  const claimedDetailValues = new Set<string>();
  for (const init of initiatives) {
    if (init.lead_source_detail_values && init.lead_source_detail_values.length > 0) {
      for (const v of init.lead_source_detail_values) {
        claimedDetailValues.add(v);
      }
    }
  }

  return initiatives.map((init) => {
    const hasDetailFilter = init.lead_source_detail_values && init.lead_source_detail_values.length > 0;

    const matchingDeals = allDeals.filter((d) => {
      if (!d.lead_source) return false;
      // Must match one of the initiative's lead_source values
      if (!init.lead_source_values.includes(d.lead_source)) return false;

      if (hasDetailFilter) {
        // Specific detail match required
        return d.lead_source_detail && init.lead_source_detail_values.includes(d.lead_source_detail);
      } else {
        // Catch-all: match source but exclude deals claimed by detail-specific initiatives
        return !d.lead_source_detail || !claimedDetailValues.has(d.lead_source_detail);
      }
    });

    const closedWonDeals = matchingDeals.filter((d) =>
      d.deal_stage === CLOSED_WON_STAGE_ID || d.closed_won_entered_at
    );

    // Weekly breakdown aligned to the Sun–Sat week array.
    const weekly = new Array(weeks.length).fill(0);
    for (const d of matchingDeals) {
      if (!d.hubspot_created_at) continue;
      const t = new Date(d.hubspot_created_at).getTime();
      const weekIdx = weeks.findIndex((w) => t >= w.weekStart.getTime() && t <= w.weekEnd.getTime());
      if (weekIdx >= 0) weekly[weekIdx]++;
    }

    const expectedByNow = Math.round((init.weekly_lead_pace || 0) * weeksElapsed);
    let paceStatus: 'ahead' | 'on_pace' | 'behind' = 'on_pace';
    if (expectedByNow === 0) {
      paceStatus = matchingDeals.length > 0 ? 'ahead' : 'behind';
    } else if (matchingDeals.length > expectedByNow * 1.1) {
      paceStatus = 'ahead';
    } else if (matchingDeals.length < expectedByNow * 0.9) {
      paceStatus = 'behind';
    }

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
