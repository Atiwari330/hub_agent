/**
 * Per-source demo activity breakdown for Q2.
 *
 * Answers "which lead sources are generating demo activity this quarter?"
 * by counting deals whose demo_scheduled_entered_at and/or
 * demo_completed_entered_at fall within Q2, grouped by lead_source.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo } from '@/lib/utils/quarter';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

export interface SourceDemoRow {
  source: string;
  demosScheduled: number;
  demosCompleted: number;
  completionRate: number; // 0-1
}

export async function computeSourceDemoBreakdown(
  supabase: SupabaseClient,
): Promise<SourceDemoRow[]> {
  const q2 = getQuarterInfo(2026, 2);
  const q2Start = q2.startDate.toISOString();
  const q2End = q2.endDate.toISOString();

  const { data, error } = await supabase
    .from('deals')
    .select('hubspot_deal_id, lead_source, demo_scheduled_entered_at, demo_completed_entered_at')
    .eq('pipeline', SALES_PIPELINE_ID)
    .or(
      `and(demo_scheduled_entered_at.gte.${q2Start},demo_scheduled_entered_at.lte.${q2End}),` +
        `and(demo_completed_entered_at.gte.${q2Start},demo_completed_entered_at.lte.${q2End})`,
    );

  if (error) throw new Error(`Failed to fetch Q2 demo activity: ${error.message}`);

  const q2StartMs = q2.startDate.getTime();
  const q2EndMs = q2.endDate.getTime();

  const inQ2 = (ts: string | null | undefined): boolean => {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= q2StartMs && t <= q2EndMs;
  };

  const buckets = new Map<string, { scheduled: number; completed: number }>();
  for (const d of data || []) {
    const source = d.lead_source || 'Unknown';
    const b = buckets.get(source) || { scheduled: 0, completed: 0 };
    if (inQ2(d.demo_scheduled_entered_at)) b.scheduled += 1;
    if (inQ2(d.demo_completed_entered_at)) b.completed += 1;
    buckets.set(source, b);
  }

  const rows: SourceDemoRow[] = [];
  for (const [source, b] of buckets) {
    if (b.scheduled === 0 && b.completed === 0) continue;
    rows.push({
      source,
      demosScheduled: b.scheduled,
      demosCompleted: b.completed,
      completionRate: b.scheduled > 0 ? b.completed / b.scheduled : 0,
    });
  }

  rows.sort((a, b) => b.demosCompleted - a.demosCompleted || b.demosScheduled - a.demosScheduled);
  return rows;
}
