/**
 * Hot Tracker computation engine.
 *
 * Computes three weekly metrics per AE for a given quarter:
 *   1. % of SQLs contacted within 15 minutes of entering Discovery stage
 *   2. # of calls to SQLs with a phone number
 *   3. # of proposal deals that received a gift/incentive
 */

import { createServiceClient } from '@/lib/supabase/client';
import { getQuarterInfo } from '@/lib/utils/quarter';
import { batchFetchDealEngagements } from '@/lib/hubspot/batch-engagements';
import { fetchCallsByOwner } from '@/lib/hubspot/calls';
import { chunk } from '@/lib/utils/chunk';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// 15-minute threshold in milliseconds
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// ── Types ──

export interface SqlDealDetail {
  dealId: string;
  dealName: string;
  discoveryEnteredAt: string;
  firstContactAt: string | null;
  contactedWithin15Min: boolean;
  minutesToContact: number | null;
}

interface OwnerInfo {
  id: string; // Supabase UUID
  hubspot_owner_id: string;
  first_name: string | null;
  last_name: string | null;
}

export interface WeekMetrics {
  weekNumber: number;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;

  // Metric 1
  sqlDealsCount: number;
  sqlContacted15min: number;
  sqlDealDetails: SqlDealDetail[];

  // Metric 2
  callsToSqlWithPhone: number;

  // Metric 3
  proposalDealsCount: number;
  proposalDealsWithGift: number;
}

export interface OwnerWeekMetrics extends WeekMetrics {
  ownerId: string;
  hubspotOwnerId: string;
}

export interface HotTrackerResult {
  fiscalYear: number;
  fiscalQuarter: number;
  teamWeeks: WeekMetrics[];
  byOwner: Map<string, OwnerWeekMetrics[]>; // keyed by Supabase owner UUID
}

// ── Week utilities ──

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function formatDateUTC(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getWeekNumberInQuarter(date: Date, quarterStart: Date): number {
  const diffMs = date.getTime() - quarterStart.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(14, diffWeeks + 1));
}

/** Build an array of empty week buckets covering the quarter. */
function buildWeekBuckets(quarterStart: Date, quarterEnd: Date): { weekNumber: number; weekStart: string; weekEnd: string }[] {
  const weeks: { weekNumber: number; weekStart: string; weekEnd: string }[] = [];
  let cursor = getWeekStart(quarterStart);
  let weekNum = 1;

  while (cursor.getTime() <= quarterEnd.getTime() && weekNum <= 14) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    weeks.push({
      weekNumber: weekNum,
      weekStart: formatDateUTC(cursor),
      weekEnd: formatDateUTC(weekEnd),
    });

    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    weekNum++;
  }

  return weeks;
}

function emptyWeekMetrics(w: { weekNumber: number; weekStart: string; weekEnd: string }): WeekMetrics {
  return {
    ...w,
    sqlDealsCount: 0,
    sqlContacted15min: 0,
    sqlDealDetails: [],
    callsToSqlWithPhone: 0,
    proposalDealsCount: 0,
    proposalDealsWithGift: 0,
  };
}

// ── Main computation ──

export async function computeHotTrackerForQuarter(
  year: number,
  quarter: number
): Promise<HotTrackerResult> {
  const supabase = createServiceClient();
  const qi = getQuarterInfo(year, quarter);

  // Fetch target AE owners from DB
  const { data: owners } = await supabase
    .from('owners')
    .select('id, hubspot_owner_id, first_name, last_name')
    .in('email', [...SYNC_CONFIG.TARGET_AE_EMAILS]);

  const ownerList: OwnerInfo[] = owners || [];

  // Build week skeletons
  const weekSkeletons = buildWeekBuckets(qi.startDate, qi.endDate);

  // ─────────────────────────────────────────────────
  // Metric 1: % SQLs contacted within 15 min
  // ─────────────────────────────────────────────────
  const metric1ByOwnerWeek = new Map<string, Map<number, { count: number; contacted: number; details: SqlDealDetail[] }>>();

  // Query deals that entered Discovery stage during this quarter
  const { data: sqlDeals } = await supabase
    .from('deals')
    .select('id, hubspot_deal_id, deal_name, discovery_entered_at, owner_id, hubspot_owner_id')
    .not('discovery_entered_at', 'is', null)
    .gte('discovery_entered_at', qi.startDate.toISOString())
    .lte('discovery_entered_at', qi.endDate.toISOString())
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  if (sqlDeals && sqlDeals.length > 0) {
    // Batch-fetch engagements (calls + emails) for these deals
    const dealIds = sqlDeals.map((d) => d.hubspot_deal_id);
    const engagements = await batchFetchDealEngagements(dealIds);

    for (const deal of sqlDeals) {
      const discoveryAt = new Date(deal.discovery_entered_at!).getTime();
      const weekNum = getWeekNumberInQuarter(new Date(deal.discovery_entered_at!), qi.startDate);
      const ownerId = deal.owner_id;
      if (!ownerId) continue;

      const dealEngagements = engagements.get(deal.hubspot_deal_id);
      let firstContactAt: number | null = null;

      if (dealEngagements) {
        // Check all calls and emails for the earliest one AFTER discovery entry
        const timestamps: number[] = [];

        for (const call of dealEngagements.calls) {
          if (call.properties.hs_timestamp) {
            const ts = new Date(call.properties.hs_timestamp).getTime();
            if (ts >= discoveryAt) timestamps.push(ts);
          }
        }
        for (const email of dealEngagements.emails) {
          if (email.timestamp) {
            const ts = new Date(email.timestamp).getTime();
            if (ts >= discoveryAt) timestamps.push(ts);
          }
        }

        if (timestamps.length > 0) {
          firstContactAt = Math.min(...timestamps);
        }
      }

      const contactedWithin15 = firstContactAt !== null && (firstContactAt - discoveryAt) <= FIFTEEN_MINUTES_MS;
      const minutesToContact = firstContactAt !== null
        ? Math.round((firstContactAt - discoveryAt) / 60000)
        : null;

      const detail: SqlDealDetail = {
        dealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        discoveryEnteredAt: deal.discovery_entered_at!,
        firstContactAt: firstContactAt ? new Date(firstContactAt).toISOString() : null,
        contactedWithin15Min: contactedWithin15,
        minutesToContact,
      };

      // Store per-owner per-week
      if (!metric1ByOwnerWeek.has(ownerId)) {
        metric1ByOwnerWeek.set(ownerId, new Map());
      }
      const ownerWeeks = metric1ByOwnerWeek.get(ownerId)!;
      if (!ownerWeeks.has(weekNum)) {
        ownerWeeks.set(weekNum, { count: 0, contacted: 0, details: [] });
      }
      const bucket = ownerWeeks.get(weekNum)!;
      bucket.count++;
      if (contactedWithin15) bucket.contacted++;
      bucket.details.push(detail);
    }
  }

  // ─────────────────────────────────────────────────
  // Metric 2: Calls to SQLs with phone
  // ─────────────────────────────────────────────────
  const metric2ByOwnerWeek = new Map<string, Map<number, number>>();

  // Get HubSpot deal IDs for all SQL-stage deals in the quarter
  // SQL stage = deals that have discovery_entered_at set (they've reached SQL/Discovery or beyond)
  const { data: sqlStageDealRows } = await supabase
    .from('deals')
    .select('hubspot_deal_id')
    .not('discovery_entered_at', 'is', null)
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  const sqlDealIdSet = new Set((sqlStageDealRows || []).map((d) => d.hubspot_deal_id));

  for (const owner of ownerList) {
    // Fetch all calls for this AE in the quarter
    const calls = await fetchCallsByOwner(
      owner.hubspot_owner_id,
      qi.startDate,
      qi.endDate
    );

    if (calls.length === 0) continue;

    // Batch fetch call→contact and call→deal associations
    const callIds = calls.map((c) => c.id);
    const client = getHubSpotClient();

    // Fetch call→deal and call→contact associations in parallel
    const [callDealAssocs, callContactAssocs] = await Promise.all([
      batchFetchCallAssociations(client, 'calls', 'deals', callIds),
      batchFetchCallAssociations(client, 'calls', 'contacts', callIds),
    ]);

    // Batch fetch contact phone numbers
    const allContactIds = new Set<string>();
    for (const contactSet of callContactAssocs.values()) {
      for (const cid of contactSet) allContactIds.add(cid);
    }

    const contactPhoneMap = await batchFetchContactPhones(client, Array.from(allContactIds));

    // Filter and count calls
    if (!metric2ByOwnerWeek.has(owner.id)) {
      metric2ByOwnerWeek.set(owner.id, new Map());
    }
    const ownerWeeks = metric2ByOwnerWeek.get(owner.id)!;

    for (const call of calls) {
      const callDealIds = callDealAssocs.get(call.id) || new Set<string>();
      const callContactIds = callContactAssocs.get(call.id) || new Set<string>();

      // Check: call is associated with an SQL-stage deal
      let isLinkedToSql = false;
      for (const did of callDealIds) {
        if (sqlDealIdSet.has(did)) { isLinkedToSql = true; break; }
      }
      if (!isLinkedToSql) continue;

      // Check: at least one associated contact has a phone number
      let contactHasPhone = false;
      for (const cid of callContactIds) {
        if (contactPhoneMap.get(cid)) { contactHasPhone = true; break; }
      }
      if (!contactHasPhone) continue;

      const weekNum = getWeekNumberInQuarter(call.timestamp, qi.startDate);
      ownerWeeks.set(weekNum, (ownerWeeks.get(weekNum) || 0) + 1);
    }
  }

  // ─────────────────────────────────────────────────
  // Metric 3: Proposal deals with gift (pure DB)
  // ─────────────────────────────────────────────────
  const metric3ByOwnerWeek = new Map<string, Map<number, { total: number; withGift: number }>>();

  const { data: proposalDeals } = await supabase
    .from('deals')
    .select('id, hubspot_deal_id, proposal_entered_at, sent_gift_or_incentive, owner_id')
    .not('proposal_entered_at', 'is', null)
    .gte('proposal_entered_at', qi.startDate.toISOString())
    .lte('proposal_entered_at', qi.endDate.toISOString())
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  for (const deal of proposalDeals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId) continue;

    const weekNum = getWeekNumberInQuarter(new Date(deal.proposal_entered_at!), qi.startDate);

    if (!metric3ByOwnerWeek.has(ownerId)) {
      metric3ByOwnerWeek.set(ownerId, new Map());
    }
    const ownerWeeks = metric3ByOwnerWeek.get(ownerId)!;
    if (!ownerWeeks.has(weekNum)) {
      ownerWeeks.set(weekNum, { total: 0, withGift: 0 });
    }
    const bucket = ownerWeeks.get(weekNum)!;
    bucket.total++;
    if (deal.sent_gift_or_incentive) bucket.withGift++;
  }

  // ─────────────────────────────────────────────────
  // Assemble results
  // ─────────────────────────────────────────────────
  const byOwner = new Map<string, OwnerWeekMetrics[]>();

  for (const owner of ownerList) {
    const ownerWeeks: OwnerWeekMetrics[] = weekSkeletons.map((w) => {
      const m1 = metric1ByOwnerWeek.get(owner.id)?.get(w.weekNumber);
      const m2 = metric2ByOwnerWeek.get(owner.id)?.get(w.weekNumber);
      const m3 = metric3ByOwnerWeek.get(owner.id)?.get(w.weekNumber);

      return {
        ...emptyWeekMetrics(w),
        ownerId: owner.id,
        hubspotOwnerId: owner.hubspot_owner_id,
        sqlDealsCount: m1?.count || 0,
        sqlContacted15min: m1?.contacted || 0,
        sqlDealDetails: m1?.details || [],
        callsToSqlWithPhone: m2 || 0,
        proposalDealsCount: m3?.total || 0,
        proposalDealsWithGift: m3?.withGift || 0,
      };
    });
    byOwner.set(owner.id, ownerWeeks);
  }

  // Team totals
  const teamWeeks: WeekMetrics[] = weekSkeletons.map((w) => {
    const team = emptyWeekMetrics(w);
    for (const ownerWeeks of byOwner.values()) {
      const ow = ownerWeeks.find((ow) => ow.weekNumber === w.weekNumber);
      if (ow) {
        team.sqlDealsCount += ow.sqlDealsCount;
        team.sqlContacted15min += ow.sqlContacted15min;
        team.sqlDealDetails.push(...ow.sqlDealDetails);
        team.callsToSqlWithPhone += ow.callsToSqlWithPhone;
        team.proposalDealsCount += ow.proposalDealsCount;
        team.proposalDealsWithGift += ow.proposalDealsWithGift;
      }
    }
    return team;
  });

  return {
    fiscalYear: year,
    fiscalQuarter: quarter,
    teamWeeks,
    byOwner,
  };
}

// ── Helper: batch fetch associations (lightweight version for calls) ──

async function batchFetchCallAssociations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  fromType: string,
  toType: string,
  fromIds: string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const id of fromIds) {
    result.set(id, new Set());
  }

  for (const idChunk of chunk(fromIds, 100)) {
    try {
      const response = await client.crm.associations.batchApi.read(
        fromType,
        toType,
        { inputs: idChunk.map((id: string) => ({ id })) }
      );

      for (const assoc of response.results) {
        const fromId = assoc._from.id;
        const existing = result.get(fromId) || new Set<string>();
        for (const to of assoc.to) {
          existing.add(to.id);
        }
        result.set(fromId, existing);
      }
    } catch (error) {
      console.warn(`[hot-tracker] Failed batch ${fromType}->${toType}:`, error);
    }
  }

  return result;
}

// ── Helper: batch fetch contact phone numbers ──

async function batchFetchContactPhones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  contactIds: string[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (contactIds.length === 0) return result;

  for (const idChunk of chunk(contactIds, 100)) {
    try {
      const response = await client.crm.contacts.batchApi.read({
        inputs: idChunk.map((id: string) => ({ id })),
        properties: ['phone'],
        propertiesWithHistory: [],
      });

      for (const contact of response.results) {
        const hasPhone = !!(contact.properties.phone && contact.properties.phone.trim());
        result.set(contact.id, hasPhone);
      }
    } catch (error) {
      console.warn('[hot-tracker] Failed batch contact phone fetch:', error);
    }
  }

  return result;
}
