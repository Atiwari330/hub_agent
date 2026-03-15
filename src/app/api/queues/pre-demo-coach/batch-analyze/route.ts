import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { analyzePreDemoDeal } from '../analyze/analyze-core';
import type { PreDemoCoachAnalysis } from '../analyze/analyze-core';

const MAX_BATCH_SIZE = 500;
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
  analysis?: PreDemoCoachAnalysis;
  error?: string;
}

interface DoneEvent {
  type: 'done';
  processed: number;
  successful: number;
  failed: number;
}

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PRE_DEMO_COACH);
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
            const result = await analyzePreDemoDeal(dealId);

            if (result.success) {
              const event: ProgressEvent = {
                type: 'progress',
                dealId,
                dealName: result.analysis.deal_name || 'Unknown',
                index: i + 1,
                total: dealIds.length,
                status: 'success',
                analysis: result.analysis,
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
    console.error('Batch pre-demo coach analysis error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
