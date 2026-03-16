import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeSupportTrainerTicket } from './analyze-core';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { ticketId } = body;

    if (!ticketId || typeof ticketId !== 'string') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const result = await analyzeSupportTrainerTicket(ticketId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: result.statusCode || 500 }
      );
    }

    return NextResponse.json({ analysis: result.analysis });
  } catch (error) {
    console.error('Support trainer analyze error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
