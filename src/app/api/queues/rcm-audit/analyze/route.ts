import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeRcmTicket } from './analyze-rcm-core';

// --- Route Handler ---

export async function POST(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_RCM_AUDIT);
  if (authResult instanceof NextResponse) return authResult;

  let body: { ticketId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId } = body;
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  const result = await analyzeRcmTicket(ticketId);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.statusCode || 500 }
    );
  }

  return NextResponse.json({
    success: true,
    analysis: result.analysis,
  });
}
