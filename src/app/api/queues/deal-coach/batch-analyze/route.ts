import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzeDealCoach } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 100;
const DELAY_BETWEEN_CALLS_MS = 500;

interface BatchAnalyzeRequest {
  dealIds: string[];
}

interface ProgressEvent {
  type: 'progress';
  dealId: string;
  dealName: string;
  index: number;
  total: number;
  status: 'success' | 'error';
  analysis?: {
    status: string;
    urgency: string;
    buyer_sentiment: string | null;
    deal_momentum: string | null;
    recommended_action: string;
    reasoning: string;
    confidence: number;
    key_risk: string | null;
    email_count: number;
    call_count: number;
    meeting_count: number;
    note_count: number;
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
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DEAL_COACH);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body: BatchAnalyzeRequest = await request.json();
    const { dealIds } = body;

    if (!dealIds || !Array.isArray(dealIds) || dealIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'dealIds array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (dealIds.length > MAX_BATCH_SIZE) {
      return new Response(
        JSON.stringify({ error: `Maximum batch size is ${MAX_BATCH_SIZE} deals` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let successful = 0;
        let failed = 0;

        for (let i = 0; i < dealIds.length; i++) {
          const dealId = dealIds[i];

          try {
            const result = await analyzeDealCoach(dealId);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                dealId,
                dealName: result.analysis.deal_name || 'Unknown',
                index: i + 1,
                total: dealIds.length,
                status: 'success',
                analysis: {
                  status: result.analysis.status,
                  urgency: result.analysis.urgency,
                  buyer_sentiment: result.analysis.buyer_sentiment,
                  deal_momentum: result.analysis.deal_momentum,
                  recommended_action: result.analysis.recommended_action,
                  reasoning: result.analysis.reasoning,
                  confidence: result.analysis.confidence,
                  key_risk: result.analysis.key_risk,
                  email_count: result.analysis.email_count,
                  call_count: result.analysis.call_count,
                  meeting_count: result.analysis.meeting_count,
                  note_count: result.analysis.note_count,
                  analyzed_at: result.analysis.analyzed_at,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              successful++;
            } else {
              const event: ProgressEvent = {
                type: 'progress',
                dealId,
                dealName: 'Unknown',
                index: i + 1,
                total: dealIds.length,
                status: 'error',
                error: result.error,
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              failed++;
            }
          } catch (error) {
            const event: ProgressEvent = {
              type: 'progress',
              dealId,
              dealName: 'Unknown',
              index: i + 1,
              total: dealIds.length,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            failed++;
          }

          // Delay between calls to respect rate limits
          if (i < dealIds.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
          }
        }

        // Send completion event
        const doneEvent: DoneEvent = {
          type: 'done',
          processed: dealIds.length,
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
    console.error('Batch deal coach analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
