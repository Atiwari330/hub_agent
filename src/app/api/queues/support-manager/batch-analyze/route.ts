import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeSupportManagerTicket } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 100;
const DELAY_BETWEEN_CALLS_MS = 200;

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
    issue_summary: string;
    next_action: string;
    action_owner: string;
    urgency: string;
    reasoning: string | null;
    engagement_summary: string | null;
    linear_summary: string | null;
    days_since_last_activity: number | null;
    last_activity_by: string | null;
    ticket_subject: string | null;
    company_name: string | null;
    assigned_rep: string | null;
    age_days: number | null;
    is_closed: boolean;
    has_linear: boolean;
    linear_state: string | null;
    confidence: number;
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
 * POST /api/queues/support-manager/batch-analyze
 *
 * Batch analyze multiple tickets with real-time progress updates via SSE.
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
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
            const result = await analyzeSupportManagerTicket(ticketId);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId,
                ticketSubject,
                index: i + 1,
                total: ticketIds.length,
                status: 'success',
                analysis: {
                  issue_summary: result.analysis.issue_summary,
                  next_action: result.analysis.next_action,
                  action_owner: result.analysis.action_owner,
                  urgency: result.analysis.urgency,
                  reasoning: result.analysis.reasoning,
                  engagement_summary: result.analysis.engagement_summary,
                  linear_summary: result.analysis.linear_summary,
                  days_since_last_activity: result.analysis.days_since_last_activity,
                  last_activity_by: result.analysis.last_activity_by,
                  ticket_subject: result.analysis.ticket_subject,
                  company_name: result.analysis.company_name,
                  assigned_rep: result.analysis.assigned_rep,
                  age_days: result.analysis.age_days,
                  is_closed: result.analysis.is_closed,
                  has_linear: result.analysis.has_linear,
                  linear_state: result.analysis.linear_state,
                  confidence: result.analysis.confidence,
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
    console.error('Batch support manager analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
