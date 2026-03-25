import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { generateTimeline } from '@/lib/ai/memory/narrative-generator';

/**
 * GET /api/queues/support-action-board/timeline/[ticketId]
 *
 * Returns the evolution timeline for a specific ticket.
 * Loaded on-demand when user expands the timeline section.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;

  const { ticketId } = await params;

  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
  }

  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '15', 10);
    const timeline = await generateTimeline(ticketId, limit);

    return NextResponse.json({ timeline });
  } catch (error) {
    console.error('Timeline fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
