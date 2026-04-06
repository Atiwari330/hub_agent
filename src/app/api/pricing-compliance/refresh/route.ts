import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { runPricingCompliance } from '@/lib/briefing/run-pricing-compliance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ownerEmail = body.ownerEmail as string | undefined;

  const supabase = createServiceClient();

  const { data: run } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_name: 'pricing_compliance_refresh',
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const runId = run?.id;

  try {
    const result = await runPricingCompliance({
      ownerEmails: ownerEmail ? [ownerEmail] : undefined,
      concurrency: 3,
    });

    if (runId) {
      await supabase
        .from('workflow_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result: {
            totalDeals: result.summary.totalDeals,
            analyzed: result.summary.analyzed,
            failed: result.summary.failed,
          },
        })
        .eq('id', runId);
    }

    return NextResponse.json({
      runId,
      status: 'completed',
      summary: result.summary,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (runId) {
      await supabase
        .from('workflow_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: errMsg,
        })
        .eq('id', runId);
    }

    return NextResponse.json({ runId, status: 'failed', error: errMsg }, { status: 500 });
  }
}
