/**
 * Weekly SPIFF Scorecard Data Service
 *
 * Fetches call counts per day (Mon–Sun) and weekly demo completions
 * for each tracked AE to build the weekly scorecard.
 */

import {
  fetchFilteredCallsByOwner,
  DASHBOARD_AE_EMAILS,
  type ContactFilterOptions,
} from '@/lib/hubspot/calls';
import { createServiceClient } from '@/lib/supabase/client';
import { SALES_PIPELINE_ID } from '@/lib/hubspot/stage-mappings';
import {
  SPIFF_AE_EMAILS,
  CALL_TIERS,
  DEMO_TIERS,
  getCallTier,
} from './daily-scorecard';

export { CALL_TIERS, DEMO_TIERS, getCallTier };

export interface DailyCallEntry {
  date: Date;
  dayLabel: string; // "Mon", "Tue", etc.
  calls: number;
  tier: string;
}

export interface WeeklyAEData {
  name: string;
  email: string;
  hubspotOwnerId: string;
  dailyCalls: DailyCallEntry[]; // 7 entries, Mon–Sun
  weeklyTotalCalls: number;
  weeklyCallTier: string;
  weeklyDemos: number;
  weeklyDemoTier: string;
}

export interface WeeklyScorecardData {
  weekStart: Date; // Monday
  weekEnd: Date; // Sunday
  aes: WeeklyAEData[];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Get the Monday–Sunday bounds for a week ending on the given Sunday.
 * All dates are computed in ET (America/New_York).
 */
export function getWeekBounds(sundayDate: Date): { monday: Date; sunday: Date } {
  // Get the date string in ET
  const sundayStr = sundayDate.toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  }); // YYYY-MM-DD

  // Sunday as a local date to compute Monday
  const sundayLocal = new Date(sundayStr + 'T12:00:00');
  const mondayLocal = new Date(sundayLocal);
  mondayLocal.setDate(sundayLocal.getDate() - 6);

  const mondayStr = mondayLocal.toLocaleDateString('en-CA');

  // Return as ET midnight boundaries
  const monday = new Date(`${mondayStr}T00:00:00-05:00`);
  const sunday = new Date(`${sundayStr}T23:59:59.999-05:00`);

  return { monday, sunday };
}

/**
 * Determine the demo tier label based on count
 */
export function getDemoTier(count: number): string {
  if (count >= DEMO_TIERS.TIER_3) return 'Tier 3';
  if (count >= DEMO_TIERS.TIER_2) return 'Tier 2';
  if (count >= DEMO_TIERS.TIER_1) return 'Tier 1';
  if (count >= DEMO_TIERS.BASELINE) return 'Baseline';
  return 'Below';
}

/**
 * Fetch weekly scorecard data for the week ending on the given Sunday
 */
export async function getWeeklyScorecardData(
  weekEndingSunday: Date
): Promise<WeeklyScorecardData> {
  const supabase = createServiceClient();
  const { monday, sunday } = getWeekBounds(weekEndingSunday);

  // 1. Look up AE owners from Supabase
  const { data: owners, error: ownersError } = await supabase
    .from('owners')
    .select('hubspot_owner_id, email, first_name, last_name')
    .in('email', SPIFF_AE_EMAILS);

  if (ownersError) {
    throw new Error(`Failed to fetch owners: ${ownersError.message}`);
  }

  if (!owners || owners.length === 0) {
    throw new Error('No matching AE owners found in database');
  }

  // 2. Resolve valid contact owner IDs (the 5 dashboard AEs)
  const { data: dashboardOwners } = await supabase
    .from('owners')
    .select('hubspot_owner_id')
    .in('email', DASHBOARD_AE_EMAILS);

  const validOwnerIds = new Set(
    (dashboardOwners || []).map((o) => o.hubspot_owner_id)
  );

  const contactFilter: ContactFilterOptions = {
    requirePhone: true,
    validOwnerIds,
  };

  // 3. Build the 7 day date strings (Mon–Sun) in ET
  const mondayStr = monday.toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });
  const dayDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayStr + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dayDates.push(d.toLocaleDateString('en-CA'));
  }

  // Week-wide date range for demo query
  const weekStartStr = dayDates[0];
  const weekEndStr = dayDates[6];

  // 4. Fetch data for each AE in parallel
  //    Optimization: fetch the full week of calls at once, then split by day
  const aeResults = await Promise.all(
    owners.map(async (owner) => {
      const name = [owner.first_name, owner.last_name]
        .filter(Boolean)
        .join(' ');

      // Fetch all filtered calls for the full week at once
      const weekCalls = await fetchFilteredCallsByOwner(
        owner.hubspot_owner_id,
        monday,
        sunday,
        contactFilter
      );

      // Split calls by day in ET
      const callsByDay = new Map<string, number>();
      for (const dateStr of dayDates) {
        callsByDay.set(dateStr, 0);
      }
      for (const call of weekCalls) {
        const callDate = call.timestamp.toLocaleDateString('en-CA', {
          timeZone: 'America/New_York',
        });
        if (callsByDay.has(callDate)) {
          callsByDay.set(callDate, callsByDay.get(callDate)! + 1);
        }
      }

      const dailyCalls: DailyCallEntry[] = dayDates.map((dateStr, idx) => {
        const count = callsByDay.get(dateStr) || 0;
        return {
          date: new Date(dateStr + 'T12:00:00-05:00'),
          dayLabel: DAY_LABELS[idx],
          calls: count,
          tier: getCallTier(count),
        };
      });

      const weeklyTotalCalls = weekCalls.length;

      // Query demos completed during the full week from Supabase
      const { count: weeklyDemos } = await supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('hubspot_owner_id', owner.hubspot_owner_id)
        .eq('pipeline', SALES_PIPELINE_ID)
        .gte('demo_completed_entered_at', `${weekStartStr}T00:00:00`)
        .lt('demo_completed_entered_at', `${weekEndStr}T23:59:59.999`);

      return {
        name,
        email: owner.email,
        hubspotOwnerId: owner.hubspot_owner_id,
        dailyCalls,
        weeklyTotalCalls,
        weeklyCallTier: getCallTier(weeklyTotalCalls),
        weeklyDemos: weeklyDemos ?? 0,
        weeklyDemoTier: getDemoTier(weeklyDemos ?? 0),
      };
    })
  );

  return {
    weekStart: monday,
    weekEnd: sunday,
    aes: aeResults,
  };
}
