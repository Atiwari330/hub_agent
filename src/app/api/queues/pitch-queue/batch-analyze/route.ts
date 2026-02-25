import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { analyzePitchTicket } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 100;
const DELAY_BETWEEN_CALLS_MS = 100;

interface BatchAnalyzeRequest {
  ticketIds: string[];
}

interface ProgressEvent {
  type: 'progress';
  ticketId: string;
  ticketSubject: string;
  index: number;
  total: number;
  status: 'success' | 'error';
  analysis?: {
    recommendation: string;
    confidence: number;
    customer_sentiment: string | null;
    reasoning: string | null;
    talking_points: string | null;
    contact_name: string | null;
    contact_email: string | null;
    company_name: string | null;
    analyzed_at: string;
  };
  error?: string;
}

interface DoneEvent {
  type: 'done';
  processed: number;
  successful: number;
  failed: number;
}

/**
 * POST /api/queues/pitch-queue/batch-analyze
 *
 * Batch analyze pitch opportunities for multiple tickets with real-time
 * progress updates via SSE. Processes tickets sequentially to respect rate limits.
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PITCH_QUEUE);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body: BatchAnalyzeRequest = await request.json();
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

    // Fetch ticket subjects for progress display
    const supabase = await createServerSupabaseClient();
    const { data: tickets } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .in('hubspot_ticket_id', ticketIds);

    const subjectMap = new Map(
      (tickets || []).map((t) => [t.hubspot_ticket_id, t.subject || 'Unknown'])
    );

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let successful = 0;
        let failed = 0;

        for (let i = 0; i < ticketIds.length; i++) {
          const ticketId = ticketIds[i];
          const ticketSubject = subjectMap.get(ticketId) || 'Unknown';

          try {
            const result = await analyzePitchTicket(ticketId);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId,
                ticketSubject,
                index: i + 1,
                total: ticketIds.length,
                status: 'success',
                analysis: {
                  recommendation: result.analysis.recommendation,
                  confidence: result.analysis.confidence,
                  customer_sentiment: result.analysis.customer_sentiment,
                  reasoning: result.analysis.reasoning,
                  talking_points: result.analysis.talking_points,
                  contact_name: result.analysis.contact_name,
                  contact_email: result.analysis.contact_email,
                  company_name: result.analysis.company_name,
                  analyzed_at: result.analysis.analyzed_at,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              successful++;
            } else {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId,
                ticketSubject,
                index: i + 1,
                total: ticketIds.length,
                status: 'error',
                error: result.error,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              failed++;
            }
          } catch (error) {
            const event: ProgressEvent = {
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

          // Delay between calls to respect rate limits
          if (i < ticketIds.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
          }
        }

        // Send completion event
        const doneEvent: DoneEvent = {
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
    console.error('Batch analyze pitch queue error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
