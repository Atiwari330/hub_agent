import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo } from '@/lib/utils/quarter';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';

// Stages that count as "regression" — deal went backward in the pipeline.
// Closed Lost is NOT regression; the deal progressed and had an outcome.
const REGRESSION_STAGES = {
  demoScheduled: new Set([
    SALES_PIPELINE_STAGES.MQL.id,
    SALES_PIPELINE_STAGES.SQL_LEGACY.id,
    SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
  ]),
  demoCompleted: new Set([
    SALES_PIPELINE_STAGES.MQL.id,
    SALES_PIPELINE_STAGES.SQL_LEGACY.id,
    SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
    SALES_PIPELINE_STAGES.DEMO_SCHEDULED.id,
  ]),
};

const CLOSED_WON_ID = SALES_PIPELINE_STAGES.CLOSED_WON.id;

export interface QuarterStageCounts {
  demosScheduled: number;
  demosCompleted: number;
  closedWon: number;
  closedWonRevenue: number;
  avgDealSize: number;
  closeRate: number;            // demo completed → closed won (0-1)
  scheduledToCompletedRate: number; // demo scheduled → demo completed (0-1)
}

export async function computeQuarterStageCounts(
  supabase: SupabaseClient,
  year: number,
  quarter: number
): Promise<QuarterStageCounts> {
  const qi = getQuarterInfo(year, quarter);

  // Quarter date boundaries as YYYY-MM-DD for close_date (DATE column) comparison
  const startMonth = (quarter - 1) * 3;
  const qStartDate = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, startMonth + 3, 0).getDate();
  const qEndDate = `${year}-${String(startMonth + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Run two targeted queries instead of one unfiltered query.
  // The deals table has ~2000 rows and Supabase defaults to 1000 row limit.

  // Query 1: Deals with demo timestamps that could be in this quarter
  // (We fetch all deals with non-null demo timestamps — much smaller set than all deals)
  const { data: demoDeals, error: err1 } = await supabase
    .from('deals')
    .select('id, deal_name, amount, deal_stage, demo_scheduled_entered_at, demo_completed_entered_at')
    .or('demo_scheduled_entered_at.not.is.null,demo_completed_entered_at.not.is.null');

  if (err1) throw new Error(`Failed to fetch demo deals: ${err1.message}`);

  // Query 2: Closed-won deals with close_date in this quarter
  const { data: closedWonByDate, error: err2 } = await supabase
    .from('deals')
    .select('id, deal_name, amount, deal_stage, close_date, closed_won_entered_at')
    .eq('deal_stage', CLOSED_WON_ID)
    .gte('close_date', qStartDate)
    .lte('close_date', qEndDate);

  if (err2) throw new Error(`Failed to fetch closed-won deals: ${err2.message}`);

  // Query 3: Closed-won deals by closed_won_entered_at in quarter (catches deals where close_date doesn't match)
  const { data: closedWonByTimestamp, error: err3 } = await supabase
    .from('deals')
    .select('id, deal_name, amount, deal_stage, close_date, closed_won_entered_at')
    .eq('deal_stage', CLOSED_WON_ID)
    .gte('closed_won_entered_at', qi.startDate.toISOString())
    .lte('closed_won_entered_at', qi.endDate.toISOString());

  if (err3) throw new Error(`Failed to fetch closed-won deals by timestamp: ${err3.message}`);

  // Merge closed-won results (deduplicate by id)
  const closedWonMap = new Map<string, typeof closedWonByDate extends (infer T)[] | null ? T : never>();
  for (const d of closedWonByDate || []) closedWonMap.set(d.id, d);
  for (const d of closedWonByTimestamp || []) closedWonMap.set(d.id, d);
  const closedWonDeals = Array.from(closedWonMap.values());

  function isInQuarter(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= qi.startDate && d <= qi.endDate;
  }

  // Demo Scheduled: entered in quarter, exclude regressions to MQL/SQL
  const demoScheduledDeals = (demoDeals || []).filter(
    (d) =>
      isInQuarter(d.demo_scheduled_entered_at) &&
      !REGRESSION_STAGES.demoScheduled.has(d.deal_stage)
  );

  // Demo Completed: entered in quarter, exclude regressions to MQL/SQL/Demo Scheduled
  const demoCompletedDeals = (demoDeals || []).filter(
    (d) =>
      isInQuarter(d.demo_completed_entered_at) &&
      !REGRESSION_STAGES.demoCompleted.has(d.deal_stage)
  );

  const closedWonRevenue = closedWonDeals.reduce(
    (sum, d) => sum + (d.amount ? Number(d.amount) : 0),
    0
  );
  const avgDealSize =
    closedWonDeals.length > 0 ? closedWonRevenue / closedWonDeals.length : 0;

  const demosCompleted = demoCompletedDeals.length;
  const closeRate = demosCompleted > 0 ? closedWonDeals.length / demosCompleted : 0;
  const demosScheduled = demoScheduledDeals.length;
  const scheduledToCompletedRate =
    demosScheduled > 0 ? demosCompleted / demosScheduled : 0;

  return {
    demosScheduled,
    demosCompleted,
    closedWon: closedWonDeals.length,
    closedWonRevenue,
    avgDealSize,
    closeRate,
    scheduledToCompletedRate,
  };
}
