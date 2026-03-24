import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { analyzeSupportTrainerTicket } from '@/app/api/queues/support-trainer/analyze/analyze-core';
import { analyzeSupportManagerTicket } from '@/app/api/queues/support-manager/analyze/analyze-core';
import { analyzeActionBoardTicket } from '@/app/api/queues/support-action-board/analyze/analyze-core';
import { isBusinessHours } from '@/lib/utils/business-hours';

const DELAY_BETWEEN_CALLS_MS = 500;

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/analyze-support
 *
 * Two modes controlled by query param:
 *   ?mode=full   → Re-analyze ALL open tickets (daily at 8am)
 *   (default)    → Analyze only UNANALYZED tickets (hourly)
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Skip outside business hours (9 AM – 7 PM ET, Mon–Fri)
  if (!isBusinessHours()) {
    return NextResponse.json({
      skipped: true,
      reason: 'Outside business hours (9 AM – 7 PM ET, Mon–Fri)',
    });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'new';
  const isFull = mode === 'full';

  try {
    const startTime = Date.now();

    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: isFull ? 'analyze-support-full' : 'analyze-support-new',
      status: 'running',
      started_at: new Date().toISOString(),
    });

    // Fetch open tickets
    const { data: tickets, error: ticketError } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id')
      .eq('is_closed', false);

    if (ticketError) {
      throw new Error(`Failed to fetch tickets: ${ticketError.message}`);
    }

    const allTicketIds = (tickets || []).map((t) => t.hubspot_ticket_id);

    let trainerTicketIds: string[] = [];
    let managerTicketIds: string[] = [];
    let actionBoardTicketIds: string[] = [];

    if (isFull) {
      // Full mode: re-analyze all open tickets
      trainerTicketIds = allTicketIds;
      managerTicketIds = allTicketIds;
      actionBoardTicketIds = allTicketIds;
    } else {
      // New mode: only unanalyzed tickets
      const { data: trainerAnalyses } = await supabase
        .from('ticket_trainer_analyses')
        .select('hubspot_ticket_id')
        .in('hubspot_ticket_id', allTicketIds);

      const { data: managerAnalyses } = await supabase
        .from('ticket_support_manager_analyses')
        .select('hubspot_ticket_id')
        .in('hubspot_ticket_id', allTicketIds);

      const { data: actionBoardAnalyses } = await supabase
        .from('ticket_action_board_analyses')
        .select('hubspot_ticket_id')
        .in('hubspot_ticket_id', allTicketIds);

      const analyzedTrainer = new Set((trainerAnalyses || []).map((a) => a.hubspot_ticket_id));
      const analyzedManager = new Set((managerAnalyses || []).map((a) => a.hubspot_ticket_id));
      const analyzedActionBoard = new Set((actionBoardAnalyses || []).map((a) => a.hubspot_ticket_id));

      trainerTicketIds = allTicketIds.filter((id) => !analyzedTrainer.has(id));
      managerTicketIds = allTicketIds.filter((id) => !analyzedManager.has(id));
      actionBoardTicketIds = allTicketIds.filter((id) => !analyzedActionBoard.has(id));
    }

    const results = {
      trainer: { success: 0, failed: 0, total: trainerTicketIds.length },
      manager: { success: 0, failed: 0, total: managerTicketIds.length },
      actionBoard: { success: 0, failed: 0, total: actionBoardTicketIds.length },
    };

    // Analyze trainer tickets
    for (const ticketId of trainerTicketIds) {
      try {
        const result = await analyzeSupportTrainerTicket(ticketId);
        if (result.success) {
          results.trainer.success++;
        } else {
          results.trainer.failed++;
          console.error(`Trainer analysis failed for ${ticketId}: ${result.error}`);
        }
      } catch (err) {
        results.trainer.failed++;
        console.error(`Trainer analysis error for ${ticketId}:`, err);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
    }

    // Analyze manager tickets
    for (const ticketId of managerTicketIds) {
      try {
        const result = await analyzeSupportManagerTicket(ticketId);
        if (result.success) {
          results.manager.success++;
        } else {
          results.manager.failed++;
          console.error(`Manager analysis failed for ${ticketId}: ${result.error}`);
        }
      } catch (err) {
        results.manager.failed++;
        console.error(`Manager analysis error for ${ticketId}:`, err);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
    }

    // Analyze action board tickets
    for (const ticketId of actionBoardTicketIds) {
      try {
        const result = await analyzeActionBoardTicket(ticketId);
        if (result.success) {
          results.actionBoard.success++;
        } else {
          results.actionBoard.failed++;
          console.error(`Action board analysis failed for ${ticketId}: ${result.error}`);
        }
      } catch (err) {
        results.actionBoard.failed++;
        console.error(`Action board analysis error for ${ticketId}:`, err);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_CALLS_MS));
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    await supabase.from('workflow_runs').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      metadata: { mode, duration_seconds: duration, results },
    }).eq('id', workflowId);

    return NextResponse.json({
      success: true,
      mode,
      duration_seconds: duration,
      results,
    });
  } catch (error) {
    console.error('Analyze support cron error:', error);

    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Failed to analyze support tickets', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
