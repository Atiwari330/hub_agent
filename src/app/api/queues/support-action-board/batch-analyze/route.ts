import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeActionBoardTicket } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 100;
const DELAY_BETWEEN_CALLS_MS = 200;

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { ticketIds } = body;

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'ticketIds array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (ticketIds.length > MAX_BATCH_SIZE) {
      return new Response(
        JSON.stringify({ error: `Maximum batch size is ${MAX_BATCH_SIZE} tickets` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data: tickets } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .in('hubspot_ticket_id', ticketIds);

    const subjectMap = new Map(
      (tickets || []).map((t) => [t.hubspot_ticket_id, t.subject || 'Unknown'])
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let successful = 0;
        let failed = 0;

        for (let i = 0; i < ticketIds.length; i++) {
          const ticketId = ticketIds[i];
          const ticketSubject = subjectMap.get(ticketId) || 'Unknown';

          try {
            const result = await analyzeActionBoardTicket(ticketId);

            const event = {
              type: 'progress',
              ticketId,
              ticketSubject,
              index: i + 1,
              total: ticketIds.length,
              status: result.success ? 'success' : 'error',
              analysis: result.success ? result.analysis : undefined,
              error: result.success ? undefined : result.error,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

            if (result.success) successful++;
            else failed++;
          } catch (error) {
            const event = {
              type: 'progress',
              ticketId,
              ticketSubject,
              index: i + 1,
              total: ticketIds.length,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            failed++;
          }

          if (i < ticketIds.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
          }
        }

        const doneEvent = {
          type: 'done',
          processed: ticketIds.length,
          successful,
          failed,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Batch action board analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
