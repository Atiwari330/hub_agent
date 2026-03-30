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

  // Closed Won: deal currently in closed-won stage with close_date or closed_won_entered_at in quarter
  const closedWonDeals = (deals || []).filter((d) => {
    if (d.deal_stage !== CLOSED_WON_ID) return false;
    const cwDate = d.closed_won_entered_at ? new Date(d.closed_won_entered_at) : null;
    const closeDate = d.close_date ? new Date(d.close_date) : null;
    const date = cwDate || closeDate;
    return date && date >= qi.startDate && date <= qi.endDate;
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
