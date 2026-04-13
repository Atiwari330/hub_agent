import { createClient } from '@supabase/supabase-js';
import type {
  DealsAnalysisResult,
  SourceMetrics,
  SourceDetailMetrics,
  AEMetrics,
  FunnelStage,
  StageTransition,
  RevenueByMonth,
  RevenueBySource,
  RevenueByAE,
  DuplicateRecord,
  DataQualityMetrics,
} from './types';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CW_STAGE = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';
const CL_STAGE = '4f186989-3ba2-4697-b675-6185b098d6a8';

interface DealRecord {
  hubspot_deal_id: string;
  deal_name: string | null;
  amount: string | number | null;
  close_date: string | null;
  deal_stage: string;
  pipeline: string;
  hubspot_owner_id: string | null;
  owner_id: string | null;
  hubspot_created_at: string | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
  products: string | null;
  deal_substage: string | null;
  mql_entered_at: string | null;
  discovery_entered_at: string | null;
  demo_scheduled_entered_at: string | null;
  demo_completed_entered_at: string | null;
  proposal_entered_at: string | null;
  closed_won_entered_at: string | null;
  [key: string]: string | number | null;
}

interface OwnerRecord {
  hubspot_owner_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

const DEAL_FIELDS = `
  hubspot_deal_id, deal_name, amount, close_date, deal_stage, pipeline,
  hubspot_owner_id, owner_id, hubspot_created_at, lead_source, lead_source_detail,
  last_activity_date, next_activity_date, products, deal_substage,
  mql_entered_at, discovery_entered_at, demo_scheduled_entered_at,
  demo_completed_entered_at, proposal_entered_at, closed_won_entered_at
`;

// --- Helpers ---

function daysBetween(a: string | Date, b: string | Date): number {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function winRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed > 0 ? won / closed : null;
}

function deduplicateDeals(deals: DealRecord[]): DealRecord[] {
  // Group by (deal_name lowercase + amount + close_date) to find dupes
  const groups = new Map<string, DealRecord[]>();
  for (const d of deals) {
    const key = `${(d.deal_name || '').toLowerCase().trim()}|${d.amount || 0}|${d.close_date || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const deduped: DealRecord[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      deduped.push(group[0]);
    } else {
      // Prefer the record that has an owner
      const withOwner = group.find((d) => d.hubspot_owner_id);
      deduped.push(withOwner || group[0]);
    }
  }
  return deduped;
}

function findDuplicates(deals: DealRecord[]): DuplicateRecord[] {
  const groups = new Map<string, DealRecord[]>();
  for (const d of deals) {
    const key = `${(d.deal_name || '').toLowerCase().trim()}|${d.amount || 0}|${d.close_date || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  const dupes: DuplicateRecord[] = [];
  for (const [, group] of groups) {
    if (group.length > 1) {
      dupes.push({
        dealName: group[0].deal_name || '(unnamed)',
        recordCount: group.length,
        amount: Number(group[0].amount) || 0,
        hubspotDealIds: group.map((d) => d.hubspot_deal_id),
      });
    }
  }
  return dupes;
}

// --- Data Fetching ---

type SupabaseInstance = ReturnType<typeof createClient>;

function getSupabaseClient(): SupabaseInstance {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient(url, key);
}

async function fetchAllSalesDeals(supabase: SupabaseInstance): Promise<DealRecord[]> {
  const PAGE_SIZE = 500;
  let all: DealRecord[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('deals')
      .select(DEAL_FIELDS)
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data as unknown as DealRecord[]);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function fetchOwners(supabase: SupabaseInstance): Promise<Map<string, OwnerRecord>> {
  const { data, error } = await supabase
    .from('owners')
    .select('hubspot_owner_id, first_name, last_name, email');
  if (error) throw error;
  return new Map((data as unknown as OwnerRecord[] || []).map(o => [o.hubspot_owner_id, o]));
}

// --- Main Analysis ---

export async function runDealsAnalysis(
  options?: { year?: number },
): Promise<DealsAnalysisResult> {
  const year = options?.year || new Date().getFullYear();
  const supabase = getSupabaseClient();

  const [allSales, ownerMap] = await Promise.all([
    fetchAllSalesDeals(supabase),
    fetchOwners(supabase),
  ]);

  // Cohorts
  const created = allSales.filter(
    d => d.hubspot_created_at && new Date(d.hubspot_created_at).getFullYear() === year,
  );

  const closedWonInYear = allSales.filter(d => {
    if (d.deal_stage !== CW_STAGE) return false;
    const dt = d.closed_won_entered_at
      ? new Date(d.closed_won_entered_at)
      : d.close_date
        ? new Date(d.close_date)
        : null;
    return dt && dt.getFullYear() === year;
  });

  // Deduplicate revenue deals
  const dupes = findDuplicates(closedWonInYear);
  const dedupedWon = deduplicateDeals(closedWonInYear);
  const dupeRevenueInflation =
    closedWonInYear.reduce((s, d) => s + (Number(d.amount) || 0), 0) -
    dedupedWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // === REVENUE ===
  const totalRevenue = dedupedWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const revAmounts = dedupedWon.map(d => Number(d.amount) || 0).filter(a => a > 0);

  // By month
  const monthMap = new Map<string, { deals: number; revenue: number }>();
  for (const d of dedupedWon) {
    const dt = d.closed_won_entered_at
      ? new Date(d.closed_won_entered_at)
      : new Date(d.close_date!);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(key)) monthMap.set(key, { deals: 0, revenue: 0 });
    const m = monthMap.get(key)!;
    m.deals++;
    m.revenue += Number(d.amount) || 0;
  }
  const byMonth: RevenueByMonth[] = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({ month, deals: m.deals, revenue: m.revenue }));

  // By source
  const srcRevMap = new Map<string, { deals: number; revenue: number }>();
  for (const d of dedupedWon) {
    const src = d.lead_source || '(blank)';
    if (!srcRevMap.has(src)) srcRevMap.set(src, { deals: 0, revenue: 0 });
    const m = srcRevMap.get(src)!;
    m.deals++;
    m.revenue += Number(d.amount) || 0;
  }
  const bySource: RevenueBySource[] = [...srcRevMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([source, m]) => ({
      source,
      deals: m.deals,
      revenue: m.revenue,
      pctOfRevenue: totalRevenue > 0 ? m.revenue / totalRevenue : 0,
    }));

  // By AE
  const aeRevMap = new Map<string, { name: string; email: string; deals: number; revenue: number }>();
  for (const d of dedupedWon) {
    const oid = d.hubspot_owner_id || 'unknown';
    const o = ownerMap.get(oid);
    const name = o ? `${o.first_name} ${o.last_name}` : oid;
    const email = o?.email || '';
    if (!aeRevMap.has(oid)) aeRevMap.set(oid, { name, email, deals: 0, revenue: 0 });
    const m = aeRevMap.get(oid)!;
    m.deals++;
    m.revenue += Number(d.amount) || 0;
  }
  const byAE: RevenueByAE[] = [...aeRevMap.values()].sort((a, b) => b.revenue - a.revenue);

  // === CONVERSION (created in year) ===
  const won = created.filter(d => d.deal_stage === CW_STAGE);
  const lost = created.filter(d => d.deal_stage === CL_STAGE);
  const open = created.filter(d => d.deal_stage !== CW_STAGE && d.deal_stage !== CL_STAGE);
  const wonRev = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const openRev = open.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const wonWithDates = won.filter(d => d.hubspot_created_at && d.closed_won_entered_at);
  const wonDays = wonWithDates.map(d => daysBetween(d.hubspot_created_at!, d.closed_won_entered_at!));

  // === LEAD SOURCES (created in year) ===
  const srcGroups = new Map<string, DealRecord[]>();
  for (const d of created) {
    const src = d.lead_source || '(blank)';
    if (!srcGroups.has(src)) srcGroups.set(src, []);
    srcGroups.get(src)!.push(d);
  }

  const leadSources: SourceMetrics[] = [];
  for (const [source, deals] of srcGroups) {
    const w = deals.filter((d: DealRecord) => d.deal_stage === CW_STAGE);
    const l = deals.filter((d: DealRecord) => d.deal_stage === CL_STAGE);
    const o = deals.filter((d: DealRecord) => d.deal_stage !== CW_STAGE && d.deal_stage !== CL_STAGE);
    const wr = w.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const wa = w.map((d: DealRecord) => Number(d.amount) || 0).filter((a: number) => a > 0);
    const wDates = w.filter((d: DealRecord) => d.hubspot_created_at && d.closed_won_entered_at);
    const wDays = wDates.map((d: DealRecord) => daysBetween(d.hubspot_created_at!, d.closed_won_entered_at!));
    const demo = deals.filter(
      (d: DealRecord) => d.demo_scheduled_entered_at || d.demo_completed_entered_at,
    ).length;

    leadSources.push({
      source,
      total: deals.length,
      won: w.length,
      lost: l.length,
      open: o.length,
      winRate: winRate(w.length, l.length),
      wonRevenue: wr,
      avgDealSize: wa.length > 0 ? wa.reduce((a: number, b: number) => a + b, 0) / wa.length : 0,
      avgDaysToClose: wDays.length > 0 ? wDays.reduce((a, b) => a + b, 0) / wDays.length : null,
      medianDaysToClose: wDays.length > 0 ? median(wDays) : null,
      demoCount: demo,
      demoRate: deals.length > 0 ? demo / deals.length : 0,
    });
  }
  leadSources.sort((a, b) => b.total - a.total);

  // Lead source details
  const detGroups = new Map<string, { total: number; won: number; lost: number; rev: number }>();
  for (const d of created) {
    const src = d.lead_source || '(blank)';
    const det = d.lead_source_detail || '(none)';
    const key = `${src}|||${det}`;
    if (!detGroups.has(key)) detGroups.set(key, { total: 0, won: 0, lost: 0, rev: 0 });
    const g = detGroups.get(key)!;
    g.total++;
    if (d.deal_stage === CW_STAGE) {
      g.won++;
      g.rev += Number(d.amount) || 0;
    }
    if (d.deal_stage === CL_STAGE) g.lost++;
  }
  const leadSourceDetails: SourceDetailMetrics[] = [...detGroups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 30)
    .map(([key, g]) => {
      const [source, detail] = key.split('|||');
      return {
        source,
        detail,
        total: g.total,
        won: g.won,
        lost: g.lost,
        wonRevenue: g.rev,
        winRate: winRate(g.won, g.lost),
      };
    });

  // === AE PERFORMANCE (created in year) ===
  const aeGroups = new Map<string, DealRecord[]>();
  for (const d of created) {
    const oid = d.hubspot_owner_id || 'unknown';
    if (!aeGroups.has(oid)) aeGroups.set(oid, []);
    aeGroups.get(oid)!.push(d);
  }

  const aePerformance: AEMetrics[] = [];
  for (const [oid, deals] of aeGroups) {
    const o = ownerMap.get(oid);
    const name = o ? `${o.first_name} ${o.last_name}` : oid;
    const email = o?.email || '';
    const w = deals.filter((d: DealRecord) => d.deal_stage === CW_STAGE);
    const l = deals.filter((d: DealRecord) => d.deal_stage === CL_STAGE);
    const op = deals.filter((d: DealRecord) => d.deal_stage !== CW_STAGE && d.deal_stage !== CL_STAGE);
    const wr = w.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const wDates = w.filter((d: DealRecord) => d.hubspot_created_at && d.closed_won_entered_at);
    const wDays = wDates.map((d: DealRecord) => daysBetween(d.hubspot_created_at!, d.closed_won_entered_at!));

    // Source breakdown
    const aeSrc = new Map<string, { t: number; w: number; l: number }>();
    for (const d of deals) {
      const src = d.lead_source || '(blank)';
      if (!aeSrc.has(src)) aeSrc.set(src, { t: 0, w: 0, l: 0 });
      const m = aeSrc.get(src)!;
      m.t++;
      if (d.deal_stage === CW_STAGE) m.w++;
      if (d.deal_stage === CL_STAGE) m.l++;
    }

    aePerformance.push({
      ownerId: oid,
      name,
      email,
      total: deals.length,
      won: w.length,
      lost: l.length,
      open: op.length,
      winRate: winRate(w.length, l.length),
      wonRevenue: wr,
      avgDaysToClose: wDays.length > 0 ? wDays.reduce((a, b) => a + b, 0) / wDays.length : null,
      sourceBreakdown: [...aeSrc.entries()]
        .sort((a, b) => b[1].t - a[1].t)
        .map(([source, m]) => ({
          source,
          total: m.t,
          won: m.w,
          lost: m.l,
          winRate: winRate(m.w, m.l),
        })),
    });
  }
  aePerformance.sort((a, b) => b.total - a.total);

  // === FUNNEL (created in year) ===
  const funnelFields: [string, string][] = [
    ['mql_entered_at', 'MQL'],
    ['discovery_entered_at', 'SQL/Discovery'],
    ['demo_scheduled_entered_at', 'Demo Scheduled'],
    ['demo_completed_entered_at', 'Demo Completed'],
    ['proposal_entered_at', 'Proposal'],
    ['closed_won_entered_at', 'Closed Won'],
  ];

  const stages: FunnelStage[] = funnelFields.map(([field, stage]) => {
    const reached = created.filter(d => d[field]).length;
    return { stage, reached, pctOfTotal: created.length > 0 ? reached / created.length : 0 };
  });

  const transitionPairs: [string, string, string, string][] = [
    ['mql_entered_at', 'discovery_entered_at', 'MQL', 'SQL/Discovery'],
    ['discovery_entered_at', 'demo_scheduled_entered_at', 'SQL/Discovery', 'Demo Scheduled'],
    ['demo_scheduled_entered_at', 'demo_completed_entered_at', 'Demo Scheduled', 'Demo Completed'],
    ['demo_completed_entered_at', 'proposal_entered_at', 'Demo Completed', 'Proposal'],
    ['proposal_entered_at', 'closed_won_entered_at', 'Proposal', 'Closed Won'],
  ];

  const transitions: StageTransition[] = transitionPairs.map(
    ([fromField, toField, fromName, toName]) => {
      const fromCount = created.filter(d => d[fromField]).length;
      const toCount = created.filter(d => d[toField]).length;
      const valid = created.filter(d => d[fromField] && d[toField]);
      const ds = valid.map(d => daysBetween(d[fromField] as string, d[toField] as string));
      return {
        from: fromName,
        to: toName,
        rate: fromCount > 0 ? toCount / fromCount : 0,
        avgDays: ds.length > 0 ? ds.reduce((a, b) => a + b, 0) / ds.length : null,
        medianDays: ds.length > 0 ? median(ds) : null,
        sampleSize: valid.length,
      };
    },
  );

  // === DATA QUALITY ===
  const missingAmount = created.filter(d => !d.amount || Number(d.amount) === 0).length;
  const missingLeadSource = created.filter(d => !d.lead_source).length;
  const missingCloseDate = created.filter(d => !d.close_date).length;
  const missingOwner = created.filter(d => !d.hubspot_owner_id).length;

  const dataQuality: DataQualityMetrics = {
    totalDeals: created.length,
    missingAmount,
    missingAmountPct: created.length > 0 ? missingAmount / created.length : 0,
    missingLeadSource,
    missingLeadSourcePct: created.length > 0 ? missingLeadSource / created.length : 0,
    missingCloseDate,
    missingCloseDatePct: created.length > 0 ? missingCloseDate / created.length : 0,
    missingOwner,
    missingOwnerPct: created.length > 0 ? missingOwner / created.length : 0,
    duplicatesFound: dupes,
    duplicateRevenueInflation: dupeRevenueInflation,
  };

  return {
    analysisDate: new Date().toISOString().split('T')[0],
    year,
    revenue: {
      totalDeals: dedupedWon.length,
      totalRevenue,
      avgDealSize: revAmounts.length > 0 ? revAmounts.reduce((a, b) => a + b, 0) / revAmounts.length : 0,
      medianDealSize: median(revAmounts),
      byMonth,
      bySource,
      byAE,
    },
    conversion: {
      totalCreated: created.length,
      closedWon: won.length,
      closedLost: lost.length,
      stillOpen: open.length,
      winRateOfClosed: winRate(won.length, lost.length),
      wonRevenue: wonRev,
      openPipeline: openRev,
      avgDaysToClose: wonDays.length > 0 ? wonDays.reduce((a, b) => a + b, 0) / wonDays.length : null,
      medianDaysToClose: wonDays.length > 0 ? median(wonDays) : null,
    },
    leadSources,
    leadSourceDetails,
    aePerformance,
    funnel: { stages, transitions },
    dataQuality,
  };
}
