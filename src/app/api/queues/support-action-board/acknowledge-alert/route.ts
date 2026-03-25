import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { acknowledgeAlert } from '@/lib/ai/intelligence/alert-utils';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const currentUser = authResult;

  try {
    const body = await request.json();
    const { alertId } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
    }

    await acknowledgeAlert(alertId, currentUser.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Acknowledge alert error:', error);
    return NextResponse.json(
      { error: 'Failed to acknowledge alert', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
