/**
 * Daily SPIFF Scorecard Data Service
 *
 * Fetches previous-day call counts (from HubSpot) and demo completions
 * (from Supabase) for each tracked AE to build the daily scorecard.
 */

import { fetchCallsByOwner } from '@/lib/hubspot/calls';
import { createServiceClient } from '@/lib/supabase/client';
import { SALES_PIPELINE_ID } from '@/lib/hubspot/stage-mappings';

// AEs tracked for the SPIFF program
export const SPIFF_AE_EMAILS = [
  'aboyd@opusbehavioral.com',
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
];

// SPIFF tier thresholds for daily calls
export const CALL_TIERS = {
  BASELINE: 25,
  TIER_1: 50,
  TIER_2: 75,
  TIER_3: 100,
} as const;

// SPIFF tier thresholds for weekly demos
export const DEMO_TIERS = {
  BASELINE: 2,
  TIER_1: 3,
  TIER_2: 4,
  TIER_3: 6,
} as const;

export interface AEScorecardData {
  name: string;
  email: string;
  hubspotOwnerId: string;
  qualifiedCalls: number;
  totalCalls: number;
  callTier: string;
  demosYesterday: number;
}

export interface DailyScorecardData {
  date: Date; // The day being reported on
  aes: AEScorecardData[];
}

/**
 * Determine the call tier label based on count
 */
export function getCallTier(count: number): string {
  if (count >= CALL_TIERS.TIER_3) return 'Tier 3';
  if (count >= CALL_TIERS.TIER_2) return 'Tier 2';
  if (count >= CALL_TIERS.TIER_1) return 'Tier 1';
  if (count >= CALL_TIERS.BASELINE) return 'Baseline';
  return 'Below';
}

/**
 * Get the start and end of a given date in ET (America/New_York)
 */
function getDayBoundsET(date: Date): { start: Date; end: Date } {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  // Start of day in ET
  const start = new Date(`${dateStr}T00:00:00-05:00`);
  // End of day in ET
  const end = new Date(`${dateStr}T23:59:59.999-05:00`);
  return { start, end };
}

/**
 * Get the previous business day (skips weekends).
 * If today is Monday, returns Friday. Otherwise returns yesterday.
 */
export function getPreviousBusinessDay(today: Date = new Date()): Date {
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = dayOfWeek === 1 ? 3 : dayOfWeek === 0 ? 2 : 1;
  const prev = new Date(today);
  prev.setDate(prev.getDate() - daysBack);
  return prev;
}

/**
 * Fetch scorecard data for a given reporting date
 */
export async function getDailyScorecardData(
  reportDate: Date
): Promise<DailyScorecardData> {
  const supabase = createServiceClient();

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

  // 2. Get day bounds for the report date
  const { start, end } = getDayBoundsET(reportDate);

  // Date string for Supabase queries (YYYY-MM-DD)
  const reportDateStr = reportDate.toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  });

  // 3. Fetch data for each AE in parallel
  const aeResults = await Promise.all(
    owners.map(async (owner) => {
      const name = [owner.first_name, owner.last_name]
        .filter(Boolean)
        .join(' ');

      // Fetch calls from HubSpot
      const calls = await fetchCallsByOwner(
        owner.hubspot_owner_id,
        start,
        end
      );

      // Count all calls (manually-logged calls have no duration data)
      const qualifiedCalls = calls;

      // Query demos completed yesterday from Supabase
      const { count: demosYesterday } = await supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('hubspot_owner_id', owner.hubspot_owner_id)
        .eq('pipeline', SALES_PIPELINE_ID)
        .gte('demo_completed_entered_at', `${reportDateStr}T00:00:00`)
        .lt('demo_completed_entered_at', `${reportDateStr}T23:59:59.999`);

      return {
        name,
        email: owner.email,
        hubspotOwnerId: owner.hubspot_owner_id,
        qualifiedCalls: qualifiedCalls.length,
        totalCalls: calls.length,
        callTier: getCallTier(qualifiedCalls.length),
        demosYesterday: demosYesterday ?? 0,
      };
    })
  );

  return {
    date: reportDate,
    aes: aeResults,
  };
}
