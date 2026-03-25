import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import type { PassType } from '@/lib/ai/passes/types';

const VALID_PASSES: PassType[] = [
  'situation', 'action_items', 'temperature', 'timing',
  'verification', 'cross_ticket', 'response_draft',
];

// POST /api/queues/support-action-board/analyze-pass
// Body: { ticketId: string, passes: PassType[] }
//
// Triggers specific analysis passes for a ticket.
// Use cases (Phase 3 webhooks):
//   Customer reply  → ['situation', 'action_items', 'temperature', 'timing', 'response_draft']
//   Agent response  → ['verification', 'timing', 'action_items']
//   Linear change   → ['situation', 'action_items']
//   Action complete → ['verification']

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { ticketId, passes } = body;

    if (!ticketId || typeof ticketId !== 'string') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    if (!Array.isArray(passes) || passes.length === 0) {
      return NextResponse.json({ error: 'passes array is required and must not be empty' }, { status: 400 });
    }

    const invalidPasses = passes.filter((p: string) => !VALID_PASSES.includes(p as PassType));
    if (invalidPasses.length > 0) {
      return NextResponse.json(
        { error: `Invalid passes: ${invalidPasses.join(', ')}. Valid: ${VALID_PASSES.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await runAnalysisPipeline(ticketId, { passes: passes as PassType[] });

    return NextResponse.json({
      success: true,
      ticketId,
      passesRun: passes,
      analysis: result.analysis,
    });
  } catch (error) {
    console.error('Selective pass analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to run analysis passes', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
