import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- Constants ---
const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CLOSED_WON_STAGE = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';
const CLOSED_LOST_STAGE = '4f186989-3ba2-4697-b675-6185b098d6a8';

const ACTIVE_STAGE_IDS = [
  '17915773',      // SQL (legacy)
  '138092708',     // SQL/Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf', // Demo - Scheduled
  '963167283',     // Demo - Completed
  '1286807303',    // Qualified/Validated
  '59865091',      // Proposal/Evaluating
  '1286807304',    // MSA Sent/Review
];

const UPSELL_PIPELINE_ID = '130845758';
const UPSELL_CLOSED_WON = '226986249';
const UPSELL_ACTIVE_STAGES = ['226988101', '226988102', '1054253346', '226986248'];

// Q1 2026
const Q_LABEL = 'Q1 2026';
const Q_START_DATE = '2026-01-01';
const Q_END_DATE = '2026-03-31';
const Q_START_TS = '2026-01-01T00:00:00.000Z';
const Q_END_TS = '2026-03-31T23:59:59.999Z';

// --- Formatting helpers ---
const fmt = (n: number | null | undefined) => {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
};

const fmtCompact = (n: number | null | undefined) => {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n);
};

const fmtPct = (n: number) => `${Math.round(n)}%`;

const pad = (label: string, value: string, width = 30) =>
  `  ${label.padEnd(width)} ${value}`;

// --- Main ---
async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  OPUS BEHAVIORAL HEALTH — ' + Q_LABEL + ' TOWN HALL DATA');
  console.log('  Generated: ' + new Date().toISOString().slice(0, 10));
  console.log('='.repeat(60));

  // Run all queries in parallel
  const [
    closedWonResult,
    closedLostResult,
    quotaResult,
    funnelResult,
    allSalesDealsResult,
    activePipelineResult,
    upsellActiveResult,
    upsellClosedResult,
    ticketsResult,
  ] = await Promise.all([
    // 1. Closed-won deals (Sales Pipeline, Q1)
    supabase
      .from('deals')
      .select('deal_name, amount, close_date, hubspot_created_at, lead_source')
      .eq('pipeline', SALES_PIPELINE_ID)
      .eq('deal_stage', CLOSED_WON_STAGE)
      .gte('close_date', Q_START_DATE)
      .lte('close_date', Q_END_DATE),

    // 2. Closed-lost deals (Sales Pipeline, Q1)
    supabase
      .from('deals')
      .select('id')
      .eq('pipeline', SALES_PIPELINE_ID)
      .eq('deal_stage', CLOSED_LOST_STAGE)
      .gte('close_date', Q_START_DATE)
      .lte('close_date', Q_END_DATE),

    // 3. Quotas for Q1
    supabase
      .from('quotas')
      .select('quota_amount')
      .eq('fiscal_year', 2026)
      .eq('fiscal_quarter', 1),

    // 4. Funnel — all sales pipeline deals with stage entry timestamps
    supabase
      .from('deals')
      .select('mql_entered_at, discovery_entered_at, demo_scheduled_entered_at, demo_completed_entered_at, proposal_entered_at, closed_won_entered_at')
      .eq('pipeline', SALES_PIPELINE_ID),

    // 5. All sales pipeline deals created in Q1 (for lead source volume)
    supabase
      .from('deals')
      .select('lead_source')
      .eq('pipeline', SALES_PIPELINE_ID)
      .gte('hubspot_created_at', Q_START_TS)
      .lte('hubspot_created_at', Q_END_TS),

    // 6. Active sales pipeline
    supabase
      .from('deals')
      .select('amount')
      .eq('pipeline', SALES_PIPELINE_ID)
      .in('deal_stage', ACTIVE_STAGE_IDS),

    // 7. Active upsell pipeline
    supabase
      .from('deals')
      .select('amount')
      .eq('pipeline', UPSELL_PIPELINE_ID)
      .in('deal_stage', UPSELL_ACTIVE_STAGES),

    // 8. Upsell closed-won (Q1)
    supabase
      .from('deals')
      .select('deal_name, amount')
      .eq('pipeline', UPSELL_PIPELINE_ID)
      .eq('deal_stage', UPSELL_CLOSED_WON)
      .gte('close_date', Q_START_DATE)
      .lte('close_date', Q_END_DATE),

    // 9. Support tickets created in Q1
    supabase
      .from('support_tickets')
      .select('id, is_closed, time_to_close, frt_sla_breached, nrt_sla_breached, closed_date, hubspot_created_at'),
  ]);

  // ========== SECTION 1: NEW SALES REVENUE ==========
  const wonDeals = closedWonResult.data || [];
  const lostCount = (closedLostResult.data || []).length;

  const totalRevenue = wonDeals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const wonCount = wonDeals.length;
  const avgDealSize = wonCount > 0 ? totalRevenue / wonCount : 0;

  const totalQuota = (quotaResult.data || []).reduce((sum, q) => sum + (Number(q.quota_amount) || 0), 0);
  const attainment = totalQuota > 0 ? (totalRevenue / totalQuota) * 100 : 0;

  const winRate = (wonCount + lostCount) > 0
    ? (wonCount / (wonCount + lostCount)) * 100
    : 0;

  // Avg sales cycle
  const cycleDays = wonDeals
    .filter(d => d.hubspot_created_at && d.close_date)
    .map(d => {
      const created = new Date(d.hubspot_created_at).getTime();
      const closed = new Date(d.close_date).getTime();
      return (closed - created) / (1000 * 60 * 60 * 24);
    })
    .filter(d => d > 0);
  const avgCycle = cycleDays.length > 0
    ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length)
    : 0;

  console.log('');
  console.log('--- NEW SALES ---');
  console.log(pad('Closed-Won Revenue:', fmt(totalRevenue)));
  console.log(pad('Deals Closed:', String(wonCount)));
  console.log(pad('Avg Deal Size:', fmt(avgDealSize)));
  console.log(pad('Quota Attainment:', `${fmtPct(attainment)} (${fmtCompact(totalRevenue)} / ${fmtCompact(totalQuota)})`));
  console.log(pad('Win Rate:', `${fmtPct(winRate)} (${wonCount}W / ${lostCount}L)`));
  console.log(pad('Avg Sales Cycle:', `${avgCycle} days`));

  // ========== SECTION 2: SALES FUNNEL ==========
  const funnelDeals = funnelResult.data || [];

  const inQ1 = (ts: string | null) =>
    ts != null && ts >= Q_START_TS && ts <= Q_END_TS;

  const mqls = funnelDeals.filter(d => inQ1(d.mql_entered_at)).length;
  const discoveries = funnelDeals.filter(d => inQ1(d.discovery_entered_at)).length;
  const demosScheduled = funnelDeals.filter(d => inQ1(d.demo_scheduled_entered_at)).length;
  const demosCompleted = funnelDeals.filter(d => inQ1(d.demo_completed_entered_at)).length;
  const proposals = funnelDeals.filter(d => inQ1(d.proposal_entered_at)).length;

  // Use the definitive closed-won count (from close_date query) since
  // closed_won_entered_at timestamps aren't populated on all deals
  const demoToCloseRate = demosCompleted > 0
    ? (wonCount / demosCompleted) * 100
    : 0;

  console.log('');
  console.log('--- SALES FUNNEL (' + Q_LABEL + ') ---');
  console.log(pad('MQLs Generated:', String(mqls)));
  console.log(pad('Moved to Discovery:', String(discoveries)));
  console.log(pad('Demos Scheduled:', String(demosScheduled)));
  console.log(pad('Demos Completed:', String(demosCompleted)));
  console.log(pad('Proposals Sent:', String(proposals)));
  console.log(pad('Closed Won:', String(wonCount)));
  console.log(pad('Demo → Close Rate:', fmtPct(demoToCloseRate)));

  // ========== SECTION 3: LEAD SOURCE VOLUME ==========
  const allSalesDeals = allSalesDealsResult.data || [];
  const leadSourceCounts = new Map<string, number>();
  for (const d of allSalesDeals) {
    const source = d.lead_source;
    if (!source) continue; // skip unknown/null
    leadSourceCounts.set(source, (leadSourceCounts.get(source) || 0) + 1);
  }

  const sortedSources = [...leadSourceCounts.entries()]
    .sort((a, b) => b[1] - a[1]);

  const totalLeads = sortedSources.reduce((s, [, c]) => s + c, 0);

  console.log('');
  console.log('--- LEAD SOURCES (' + Q_LABEL + ', New Deals Created) ---');
  console.log(pad('Total Leads:', String(totalLeads)));
  for (const [source, count] of sortedSources) {
    const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
    console.log(pad(`${source}:`, `${count} (${pct}%)`));
  }

  // ========== SECTION 4: ACTIVE PIPELINE ==========
  const activeSales = activePipelineResult.data || [];
  const activeSalesValue = activeSales.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const activeUpsells = upsellActiveResult.data || [];
  const activeUpsellValue = activeUpsells.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  console.log('');
  console.log('--- ACTIVE PIPELINE ---');
  console.log(pad('Sales Pipeline:', `${fmtCompact(activeSalesValue)} across ${activeSales.length} deals`));
  console.log(pad('Upsell Pipeline:', `${fmtCompact(activeUpsellValue)} across ${activeUpsells.length} deals`));

  // ========== SECTION 5: UPSELLS CLOSED ==========
  const upsellWon = upsellClosedResult.data || [];
  const upsellRevenue = upsellWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  // $1,897 was Opus-impacted (internal); the rest are organic upsells
  const opusImpacted = 1897;
  const organicUpsell = upsellRevenue - opusImpacted;

  console.log('');
  console.log('--- UPSELLS (' + Q_LABEL + ') ---');
  console.log(pad('Upsells Closed:', `${String(upsellWon.length)} deals`));
  console.log(pad('Total Upsell Revenue:', fmt(upsellRevenue)));
  console.log(pad('  Organic:', fmt(organicUpsell)));
  console.log(pad('  Opus-Impacted:', fmt(opusImpacted)));

  // ========== SECTION 6: SUPPORT SNAPSHOT ==========
  const allTickets = ticketsResult.data || [];
  const q1Tickets = allTickets.filter(t =>
    t.hubspot_created_at && t.hubspot_created_at >= Q_START_TS && t.hubspot_created_at <= Q_END_TS
  );
  const q1Resolved = allTickets.filter(t =>
    t.is_closed && t.closed_date && t.closed_date >= Q_START_TS && t.closed_date <= Q_END_TS
  );

  const resolvedWithTime = q1Resolved.filter(t => t.time_to_close != null && Number(t.time_to_close) > 0);
  const avgResolutionMs = resolvedWithTime.length > 0
    ? resolvedWithTime.reduce((s, t) => s + Number(t.time_to_close), 0) / resolvedWithTime.length
    : 0;
  const avgResolutionHours = Math.round(avgResolutionMs / (1000 * 60 * 60));

  const slaCompliant = q1Resolved.filter(t => !t.frt_sla_breached && !t.nrt_sla_breached).length;
  const slaRate = q1Resolved.length > 0
    ? (slaCompliant / q1Resolved.length) * 100
    : 0;

  console.log('');
  console.log('--- SUPPORT (' + Q_LABEL + ') ---');
  console.log(pad('Tickets Opened:', String(q1Tickets.length)));
  console.log(pad('Tickets Resolved:', String(q1Resolved.length)));
  if (avgResolutionHours > 24) {
    console.log(pad('Avg Resolution Time:', `${Math.round(avgResolutionHours / 24)} days`));
  } else {
    console.log(pad('Avg Resolution Time:', `${avgResolutionHours} hours`));
  }
  console.log(pad('SLA Compliance:', fmtPct(slaRate)));

  console.log('');
  console.log('='.repeat(60));
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
