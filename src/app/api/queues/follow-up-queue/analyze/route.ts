import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeFollowUpTicket } from './analyze-core';
import type { ViolationContext } from './analyze-core';

interface RequestBody {
  ticketId: string;
  violationType: ViolationContext['violationType'];
  violationLabel: string;
  severity: ViolationContext['severity'];
  gapHours: number;
  gapDisplay: string;
  ownerName: string | null;
  ownerId: string | null;
}

export async function POST(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_FOLLOW_UP);
  if (authResult instanceof NextResponse) return authResult;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId, violationType, violationLabel, severity, gapHours, gapDisplay, ownerName, ownerId } = body;
  if (!ticketId || !violationType || !severity) {
    return NextResponse.json({ error: 'ticketId, violationType, and severity are required' }, { status: 400 });
  }

  const violationContext: ViolationContext = {
    violationType,
    violationLabel: violationLabel || violationType,
    severity,
    gapHours: gapHours || 0,
    gapDisplay: gapDisplay || '',
    ownerName: ownerName || null,
    ownerId: ownerId || null,
  };

  const result = await analyzeFollowUpTicket(ticketId, violationContext);

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
