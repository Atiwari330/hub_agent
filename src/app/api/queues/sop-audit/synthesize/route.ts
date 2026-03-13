import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { runSopSynthesis } from './synthesize-sop-core';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
  if (authResult instanceof NextResponse) return authResult;

  try {
    let body: { mode?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine
    }

    const mode = (body.mode || 'all') as 'open' | 'all';
    const report = await runSopSynthesis(undefined, { mode });
    return NextResponse.json(report);
  } catch (error) {
    console.error('SOP audit synthesis error:', error);
    return NextResponse.json(
      {
        error: 'Failed to synthesize SOP audit report',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
