import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getDealWithNextStepHistory } from '@/lib/hubspot/deals';
import { analyzeNextStep } from '@/lib/ai/analyze-next-step';

const MAX_BATCH_SIZE = 50;
const DELAY_BETWEEN_CALLS_MS = 100;

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
    dueDate: string | null;
    confidence: number;
    displayMessage: string;
    actionType: string | null;
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
 * POST /api/queues/batch-analyze-next-step
 *
 * Batch analyze next steps for multiple deals with real-time progress updates via SSE.
 * Processes deals sequentially to respect rate limits.
 */
export async function POST(request: NextRequest) {
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

    const supabase = await createServerSupabaseClient();

    // Fetch all deals from database
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id, deal_name, next_step, owner_id')
      .in('id', dealIds);

    if (dealsError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch deals', details: dealsError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!deals || deals.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No deals found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create a map for quick lookup
    const dealMap = new Map(deals.map((d) => [d.id, d]));

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let successful = 0;
        let failed = 0;

        // Process each deal sequentially
        for (let i = 0; i < dealIds.length; i++) {
          const dealId = dealIds[i];
          const deal = dealMap.get(dealId);

          if (!deal) {
            // Deal not found in database
            const event: ProgressEvent = {
              type: 'progress',
              dealId,
              dealName: 'Unknown',
              index: i + 1,
              total: dealIds.length,
              status: 'error',
              error: 'Deal not found',
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            failed++;
            continue;
          }

          try {
            // Fetch fresh data from HubSpot
            const hubspotResult = await getDealWithNextStepHistory(deal.hubspot_deal_id);

            if (!hubspotResult) {
              throw new Error('Failed to fetch from HubSpot');
            }

            const { nextStepValue, nextStepUpdatedAt } = hubspotResult;

            // Run LLM analysis
            const analysis = await analyzeNextStep({
              nextStepText: nextStepValue,
              referenceDate: new Date(),
            });

            const analyzedAt = new Date().toISOString();

            // Store results in database
            await supabase
              .from('deals')
              .update({
                next_step: nextStepValue,
                next_step_due_date: analysis.dueDate,
                next_step_action_type: analysis.actionType,
                next_step_status: analysis.status,
                next_step_confidence: analysis.confidence,
                next_step_display_message: analysis.displayMessage,
                next_step_analyzed_at: analyzedAt,
                next_step_analyzed_value: nextStepValue,
                next_step_last_updated_at: nextStepUpdatedAt,
                updated_at: analyzedAt,
              })
              .eq('id', dealId);

            // Send success event
            const event: ProgressEvent = {
              type: 'progress',
              dealId,
              dealName: deal.deal_name,
              index: i + 1,
              total: dealIds.length,
              status: 'success',
              analysis: {
                status: analysis.status,
                dueDate: analysis.dueDate,
                confidence: analysis.confidence,
                displayMessage: analysis.displayMessage,
                actionType: analysis.actionType,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            successful++;
          } catch (error) {
            // Send error event
            const event: ProgressEvent = {
              type: 'progress',
              dealId,
              dealName: deal.deal_name,
              index: i + 1,
              total: dealIds.length,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            failed++;
          }

          // Add delay between calls to respect rate limits
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
    console.error('Batch analyze next step error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
