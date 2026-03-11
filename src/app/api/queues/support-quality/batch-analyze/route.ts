import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeTicketQuality } from '../analyze/analyze-core';

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
    overall_quality_score: number;
    quality_grade: string;
    customer_sentiment: string;
    resolution_status: string;
    handling_quality: string;
    key_observations: string;
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

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
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
            const result = await analyzeTicketQuality(ticketId);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                ticketId,
                ticketSubject,
                index: i + 1,
                total: ticketIds.length,
                status: 'success',
                analysis: {
                  overall_quality_score: result.analysis.overall_quality_score,
                  quality_grade: result.analysis.quality_grade,
                  customer_sentiment: result.analysis.customer_sentiment,
                  resolution_status: result.analysis.resolution_status,
                  handling_quality: result.analysis.handling_quality,
                  key_observations: result.analysis.key_observations,
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
    console.error('Batch quality analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
