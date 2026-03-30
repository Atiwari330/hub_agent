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

  const { data: deals, error } = await supabase
    .from('deals')
    .select(
      'id, deal_name, amount, deal_stage, demo_scheduled_entered_at, demo_completed_entered_at, closed_won_entered_at, close_date'
    );

  if (error) throw new Error(`Failed to fetch deals: ${error.message}`);

  function isInQuarter(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= qi.startDate && d <= qi.endDate;
  }

  // Demo Scheduled: entered in quarter, exclude regressions to MQL/SQL
  const demoScheduledDeals = (deals || []).filter(
    (d) =>
      isInQuarter(d.demo_scheduled_entered_at) &&
      !REGRESSION_STAGES.demoScheduled.has(d.deal_stage)
  );

  // Demo Completed: entered in quarter, exclude regressions to MQL/SQL/Demo Scheduled
  const demoCompletedDeals = (deals || []).filter(
    (d) =>
      isInQuarter(d.demo_completed_entered_at) &&
      !REGRESSION_STAGES.demoCompleted.has(d.deal_stage)
  );

  // Quarter date boundaries as YYYY-MM-DD for close_date (DATE column) comparison
  const startMonth = (quarter - 1) * 3;
  const qStartDate = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, startMonth + 3, 0).getDate();
  const qEndDate = `${year}-${String(startMonth + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Closed Won: deal currently in closed-won stage with EITHER close_date or closed_won_entered_at in quarter
  const closedWonDeals = (deals || []).filter((d) => {
    if (d.deal_stage !== CLOSED_WON_ID) return false;
    // Check close_date (DATE column) via string comparison to avoid UTC/EST issues
    const cdInQ = d.close_date && d.close_date >= qStartDate && d.close_date <= qEndDate;
    // Check closed_won_entered_at (TIMESTAMP column) via normal date comparison
    const cwInQ = d.closed_won_entered_at && new Date(d.closed_won_entered_at) >= qi.startDate && new Date(d.closed_won_entered_at) <= qi.endDate;
    return cdInQ || cwInQ;
  });

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
