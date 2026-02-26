import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeFollowUpTicket } from '../analyze/analyze-core';
import type { ViolationContext } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 100;
const DELAY_BETWEEN_CALLS_MS = 100;

interface BatchTicket {
  ticketId: string;
  violationType: ViolationContext['violationType'];
  violationLabel: string;
  severity: ViolationContext['severity'];
  gapHours: number;
  gapDisplay: string;
  ownerName: string | null;
  ownerId: string | null;
}

interface BatchAnalyzeRequest {
  tickets: BatchTicket[];
}

interface ProgressEvent {
  type: 'progress';
  ticketId: string;
  ticketSubject: string;
  index: number;
  total: number;
  status: 'success' | 'error';
  analysis?: {
    status: string;
    urgency: string;
    customer_sentiment: string | null;
    recommended_action: string;
    reasoning: string;
    last_meaningful_contact: string | null;
    confidence: number;
    engagement_count: number;
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

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_FOLLOW_UP);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body: BatchAnalyzeRequest = await request.json();
    const { tickets } = body;

    if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
      return new Response(
        JSON.stringify({ error: 'tickets array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (tickets.length > MAX_BATCH_SIZE) {
      return new Response(
        JSON.stringify({ error: `Maximum batch size is ${MAX_BATCH_SIZE} tickets` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch ticket subjects for progress display
    const supabase = await createServerSupabaseClient();
    const ticketIds = tickets.map((t) => t.ticketId);
    const { data: ticketRows } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .in('hubspot_ticket_id', ticketIds);

    const subjectMap = new Map(
      (ticketRows || []).map((t) => [t.hubspot_ticket_id, t.subject || 'Unknown'])
    );

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let successful = 0;
        let failed = 0;

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const ticketSubject = subjectMap.get(ticket.ticketId) || 'Unknown';

          const violationContext: ViolationContext = {
            violationType: ticket.violationType,
            violationLabel: ticket.violationLabel,
            severity: ticket.severity,
            gapHours: ticket.gapHours,
            gapDisplay: ticket.gapDisplay,
            ownerName: ticket.ownerName,
            ownerId: ticket.ownerId,
          };

          try {
            const result = await analyzeFollowUpTicket(ticket.ticketId, violationContext);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId: ticket.ticketId,
                ticketSubject,
                index: i + 1,
                total: tickets.length,
                status: 'success',
                analysis: {
                  status: result.analysis.status,
                  urgency: result.analysis.urgency,
                  customer_sentiment: result.analysis.customer_sentiment,
                  recommended_action: result.analysis.recommended_action,
                  reasoning: result.analysis.reasoning,
                  last_meaningful_contact: result.analysis.last_meaningful_contact,
                  confidence: result.analysis.confidence,
                  engagement_count: result.analysis.engagement_count,
                  analyzed_at: result.analysis.analyzed_at,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              successful++;
            } else {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId: ticket.ticketId,
                ticketSubject,
                index: i + 1,
                total: tickets.length,
                status: 'error',
                error: result.error,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              failed++;
            }
          } catch (error) {
            const event: ProgressEvent = {
              type: 'progress',
              ticketId: ticket.ticketId,
              ticketSubject,
              index: i + 1,
              total: tickets.length,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            failed++;
          }

          // Delay between calls to respect rate limits
          if (i < tickets.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
          }
        }

        // Send completion event
        const doneEvent: DoneEvent = {
          type: 'done',
          processed: tickets.length,
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
    console.error('Batch follow-up analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
