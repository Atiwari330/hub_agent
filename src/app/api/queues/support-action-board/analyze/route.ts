import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES, hasPermission } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/client';
import { analyzeActionBoardTicket } from './analyze-core';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!hasPermission(user, RESOURCES.ANALYZE_TICKET)) {
    return NextResponse.json({ error: 'Forbidden: analyze permission required' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { ticketId } = body;

    if (!ticketId || typeof ticketId !== 'string') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const result = await analyzeActionBoardTicket(ticketId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, details: result.details },
        { status: result.statusCode || 500 }
      );
    }

    // Log usage
    const serviceClient = createServiceClient();
    await serviceClient.from('analysis_usage_log').insert({
      user_id: user.id,
      user_email: user.email,
      user_display_name: user.displayName,
      queue_type: 'support-action-board',
      hubspot_ticket_id: ticketId,
      prompt_tokens: result.usage?.inputTokens ?? null,
      completion_tokens: result.usage?.outputTokens ?? null,
      total_tokens: result.usage?.totalTokens ?? null,
    });

    return NextResponse.json({ analysis: result.analysis });
  } catch (error) {
    console.error('Action board analyze error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
