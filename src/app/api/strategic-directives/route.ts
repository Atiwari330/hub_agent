import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';
import { createServiceClient } from '@/lib/supabase/client';
import { runStrategicDirectives } from './generate/strategic-directives-core';
import type { StrategicFocus, TimeRange } from './generate/types';

/**
 * POST /api/strategic-directives
 * Generate a new strategic directives report
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.STRATEGIC_DIRECTIVES);
  if (authResult instanceof NextResponse) return authResult;

  const user = authResult;

  try {
    const body = await request.json().catch(() => ({}));

    const validFocuses: StrategicFocus[] = ['revenue', 'churn', 'efficiency'];
    const validTimeRanges: TimeRange[] = ['7d', '30d', '90d'];

    const focus = validFocuses.includes(body.focus) ? body.focus : undefined;
    const timeRange = validTimeRanges.includes(body.timeRange)
      ? body.timeRange
      : '30d';

    const serviceClient = createServiceClient();

    const report = await runStrategicDirectives(serviceClient, {
      timeRange,
      focus,
    });

    // Store in database
    await serviceClient.from('strategic_directives').insert({
      report,
      directive_count: report.directives.length,
      overall_deal_grade: report.operationalScorecard.dealPipelineHealth.grade,
      overall_support_grade: report.operationalScorecard.supportQuality.grade,
      overall_customer_grade: report.operationalScorecard.customerHealth.grade,
      triggered_by: user.id,
      trigger_type: 'manual',
      thinking_output: report.thinkingOutput,
      data_snapshot: report.dataSources,
      phase1_duration_ms: report.phase1DurationMs,
      phase2_duration_ms: report.phase2DurationMs,
      phase3_duration_ms: report.phase3DurationMs,
      total_duration_ms: report.totalDurationMs,
    });

    return NextResponse.json(report);
  } catch (err) {
    console.error('Strategic directives error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/strategic-directives
 * Retrieve the latest or historical strategic directives reports
 */
export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.STRATEGIC_DIRECTIVES);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '1', 10), 20);

    const serviceClient = createServiceClient();

    const { data, error } = await serviceClient
      .from('strategic_directives')
      .select(
        'id, report, directive_count, overall_deal_grade, overall_support_grade, overall_customer_grade, trigger_type, data_snapshot, total_duration_ms, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    if (limit === 1 && data && data.length > 0) {
      return NextResponse.json(data[0]);
    }

    return NextResponse.json({ reports: data || [] });
  } catch (err) {
    console.error('Strategic directives fetch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
