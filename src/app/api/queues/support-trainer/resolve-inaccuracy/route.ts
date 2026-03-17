import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

/**
 * POST /api/queues/support-trainer/resolve-inaccuracy
 * Resolve an inaccuracy report (VP only)
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (user.role !== 'vp_revops') {
    return NextResponse.json({ error: 'Only VP of RevOps can resolve inaccuracy reports' }, { status: 403 });
  }

  try {
    const { reportId } = await request.json();

    if (!reportId) {
      return NextResponse.json({ error: 'reportId is required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('trainer_inaccuracy_reports')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      })
      .eq('id', reportId)
      .is('resolved_at', null)
      .select()
      .single();

    if (error) {
      console.error('Resolve inaccuracy error:', error);
      return NextResponse.json({ error: 'Failed to resolve report', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, report: data });
  } catch (error) {
    console.error('Resolve inaccuracy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
