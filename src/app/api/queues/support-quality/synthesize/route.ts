import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { runSynthesis } from './synthesize-quality-core';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
  if (authResult instanceof NextResponse) return authResult;

  try {
    let body: { mode?: string; closedDays?: number } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine — use defaults
    }

    const mode = (body.mode || 'all') as 'open' | 'closed' | 'all';
    const closedDays = body.closedDays;

    const report = await runSynthesis(undefined, { mode, closedDays });
    return NextResponse.json(report);
  } catch (error) {
    console.error('Support quality synthesis error:', error);
    return NextResponse.json(
      {
        error: 'Failed to synthesize quality report',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
