import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const supabase = await createServerSupabaseClient();

    // Count how many tickets exist and how many the user reviewed today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: totalTickets } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('is_closed', false);

    const { count: reviewedTickets } = await supabase
      .from('shift_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('reviewed_at', todayStart.toISOString());

    const { data, error } = await supabase
      .from('shift_completions')
      .insert({
        user_id: user.id,
        tickets_reviewed: reviewedTickets || 0,
        tickets_total: totalTickets || 0,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to complete shift', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      shiftCompletion: data,
    });
  } catch (error) {
    console.error('Complete shift error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
