/**
 * PPL Sequence KPI Validation Script
 *
 * Independent validation of Week 1 Compliance KPI numbers.
 * Fetches the same raw data as the API route and computes averages from scratch,
 * printing every step of the math so you can verify by hand.
 *
 * Usage: npx tsx src/scripts/validate-ppl-kpi.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { batchFetchDealEngagements } from '../lib/hubspot/batch-engagements';
import { analyzeWeek1Touches, countTouchesInRange } from '../lib/utils/touch-counter';
import { SYNC_CONFIG } from '../lib/hubspot/sync-config';
import { ALL_OPEN_STAGE_IDS } from '../lib/hubspot/stage-config';
import { getAllPipelines } from '../lib/hubspot/pipelines';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TARGET = 6;

interface DealRow {
  id: string;
  hubspot_deal_id: string | null;
  deal_name: string;
  amount: number | null;
  deal_stage: string | null;
  owner_id: string | null;
  hubspot_created_at: string | null;
  close_date: string | null;
  lead_source: string | null;
}

interface OwnerRow {
  id: string;
  hubspot_owner_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

async function main() {
  console.log('='.repeat(80));
  console.log('  PPL Sequence KPI Validation');
  console.log('  Same filters & math as /api/queues/ppl-sequence');
  console.log('='.repeat(80));
  console.log();

  // ── Step 1: Fetch target owners (exclude Adi Tiwari) ──
  const pplAeEmails = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
    (email) => email !== 'atiwari@opusbehavioral.com'
  );
  console.log(`Target AE emails: ${pplAeEmails.join(', ')}`);

  const { data: owners, error: ownerError } = await supabase
    .from('owners')
    .select('id, hubspot_owner_id, first_name, last_name, email')
    .in('email', pplAeEmails);

  if (ownerError || !owners || owners.length === 0) {
    console.error('Failed to fetch owners:', ownerError?.message || 'No owners found');
    process.exit(1);
  }

  const ownerMap = new Map<string, { name: string; email: string }>();
  for (const owner of owners as OwnerRow[]) {
    const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
    ownerMap.set(owner.id, { name, email: owner.email });
  }

  const ownerIds = owners.map((o: OwnerRow) => o.id);
  const ownerNames: string[] = [];
  ownerMap.forEach((o) => ownerNames.push(o.name));
  console.log(`Found ${owners.length} owners: ${ownerNames.join(', ')}\n`);

  // ── Step 2: Fetch PPL deals from Supabase ──
  console.log('Querying Supabase for PPL deals...');
  console.log(`  pipeline = ${SYNC_CONFIG.TARGET_PIPELINE_ID}`);
  console.log(`  deal_stage IN [${ALL_OPEN_STAGE_IDS.length} active stages]`);
  console.log(`  lead_source = 'Paid Lead'`);
  console.log();

  const { data: deals, error: dealsError } = await supabase
    .from('deals')
    .select(`
      id,
      hubspot_deal_id,
      deal_name,
      amount,
      deal_stage,
      owner_id,
      hubspot_created_at,
      close_date,
      lead_source
    `)
    .in('owner_id', ownerIds)
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
    .in('deal_stage', ALL_OPEN_STAGE_IDS)
    .eq('lead_source', 'Paid Lead')
    .order('amount', { ascending: false, nullsFirst: false });

  if (dealsError) {
    console.error('Failed to fetch deals:', dealsError.message);
    process.exit(1);
  }

  const dealRows = (deals || []) as DealRow[];
  console.log(`Found ${dealRows.length} PPL deals\n`);

  // ── Step 3: Get stage names ──
  const pipelines = await getAllPipelines();
  const salesPipeline = pipelines.find((p) => p.id === SYNC_CONFIG.TARGET_PIPELINE_ID);
  const stageMap = new Map<string, string>();
  if (salesPipeline) {
    for (const stage of salesPipeline.stages) {
      stageMap.set(stage.id, stage.label);
    }
  }

  // ── Step 4: Batch-fetch engagements from HubSpot ──
  const eligibleDealIds = dealRows
    .filter((d) => d.hubspot_deal_id && d.hubspot_created_at)
    .map((d) => d.hubspot_deal_id!);

  console.log(`Fetching engagements for ${eligibleDealIds.length} eligible deals...`);

  let engagementMap = new Map<string, { calls: import('../lib/hubspot/engagements').HubSpotCall[]; emails: import('../lib/hubspot/engagements').HubSpotEmail[]; meetings: import('../lib/hubspot/engagements').HubSpotMeeting[] }>();

  if (eligibleDealIds.length > 0) {
    try {
      engagementMap = await batchFetchDealEngagements(eligibleDealIds);
      console.log('Engagements fetched successfully.\n');
    } catch (error) {
      console.warn('Batch engagement fetch failed, all deals will be pending:', error);
      console.log();
    }
  }

  // ── Step 5: Analyze each deal ──
  console.log('-'.repeat(80));
  console.log('  DEAL-BY-DEAL BREAKDOWN');
  console.log('-'.repeat(80));

  // Group results by AE for later
  const aeDeals = new Map<string, {
    name: string;
    eligible: { dealName: string; touches: number }[];
    meetingBooked: string[];
    pending: string[];
  }>();

  // Initialize AE groups
  ownerMap.forEach((ownerInfo, ownerId) => {
    aeDeals.set(ownerId, {
      name: ownerInfo.name,
      eligible: [],
      meetingBooked: [],
      pending: [],
    });
  });

  let totalMeetingBooked = 0;
  let totalPending = 0;

  for (const deal of dealRows) {
    const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;
    const aeName = ownerInfo?.name || 'Unknown';
    const hubspotDealId = deal.hubspot_deal_id;
    const stageName = stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown';

    if (!hubspotDealId || !deal.hubspot_created_at) {
      // Pending — no HubSpot data
      console.log(`  ${aeName} | ${deal.deal_name} | PENDING - missing HubSpot data (excluded from avg)`);
      totalPending++;
      if (deal.owner_id) {
        aeDeals.get(deal.owner_id)?.pending.push(deal.deal_name);
      }
      continue;
    }

    const engagements = engagementMap.get(hubspotDealId);
    if (!engagements) {
      // Pending — no engagement data
      console.log(`  ${aeName} | ${deal.deal_name} | PENDING - no engagement data (excluded from avg)`);
      totalPending++;
      if (deal.owner_id) {
        aeDeals.get(deal.owner_id)?.pending.push(deal.deal_name);
      }
      continue;
    }

    const { calls, emails, meetings } = engagements;
    const analysis = analyzeWeek1Touches(calls, emails, deal.hubspot_created_at, TARGET, meetings);

    if (analysis.meetingBooked) {
      console.log(`  ${aeName} | ${deal.deal_name} | MEETING BOOKED on ${analysis.meetingBookedDate?.split('T')[0] || '?'} (excluded from avg) | Stage: ${stageName}`);
      totalMeetingBooked++;
      if (deal.owner_id) {
        aeDeals.get(deal.owner_id)?.meetingBooked.push(deal.deal_name);
      }
    } else {
      const { touches, gap, status } = analysis;
      const statusLabel = status.toUpperCase();
      console.log(`  ${aeName} | ${deal.deal_name} | ${touches.calls} calls + ${touches.emails} emails = ${touches.total} touches | Gap: ${gap > 0 ? '-' + gap : '0'} | Status: ${statusLabel} | Stage: ${stageName}`);
      if (deal.owner_id) {
        aeDeals.get(deal.owner_id)?.eligible.push({
          dealName: deal.deal_name,
          touches: touches.total,
        });
      }
    }
  }

  // ── Step 6: Per-AE averages ──
  console.log();
  console.log('-'.repeat(80));
  console.log('  PER-AE AVERAGES (excluding meeting-booked & pending)');
  console.log('-'.repeat(80));

  const allEligibleTouches: number[] = [];

  aeDeals.forEach((ae) => {
    if (ae.eligible.length === 0 && ae.meetingBooked.length === 0 && ae.pending.length === 0) {
      return; // AE has no PPL deals at all
    }

    const touchValues = ae.eligible.map((d) => d.touches);
    allEligibleTouches.push(...touchValues);

    if (touchValues.length > 0) {
      const sum = touchValues.reduce((a, b) => a + b, 0);
      const avg = sum / touchValues.length;
      const equation = touchValues.join(' + ');
      console.log(`  ${ae.name}: (${equation}) / ${touchValues.length} deals = ${avg.toFixed(1)} avg`);
    } else {
      console.log(`  ${ae.name}: No eligible deals (${ae.meetingBooked.length} meeting-booked, ${ae.pending.length} pending)`);
    }
  });

  // ── Step 7: Team average ──
  console.log();
  console.log('-'.repeat(80));
  console.log('  TEAM AVERAGE');
  console.log('-'.repeat(80));

  if (allEligibleTouches.length > 0) {
    const teamSum = allEligibleTouches.reduce((a, b) => a + b, 0);
    const teamAvg = teamSum / allEligibleTouches.length;
    const equation = allEligibleTouches.join(' + ');
    console.log(`  TEAM: (${equation}) / ${allEligibleTouches.length} deals = ${teamAvg.toFixed(1)} avg`);
  } else {
    console.log('  TEAM: No eligible deals for average');
  }

  // ── Step 8: Summary ──
  console.log();
  console.log('='.repeat(80));
  console.log('  SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total PPL deals:           ${dealRows.length}`);
  console.log(`  Meeting-booked (excluded):  ${totalMeetingBooked}`);
  console.log(`  Pending (excluded):         ${totalPending}`);
  console.log(`  Eligible for average:       ${allEligibleTouches.length}`);
  if (allEligibleTouches.length > 0) {
    const teamAvg = allEligibleTouches.reduce((a, b) => a + b, 0) / allEligibleTouches.length;
    console.log(`  Team average:               ${teamAvg.toFixed(1)}`);
  }
  console.log();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
