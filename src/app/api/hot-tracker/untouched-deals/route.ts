import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter } from '@/lib/utils/quarter';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.HOT_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();
  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));
  const weekNumber = parseInt(searchParams.get('weekNumber') || '1');
  const ownerId = searchParams.get('ownerId') || null;

  // Read untouched deals from the snapshot JSONB
  let query = supabase
    .from('hot_tracker_snapshots')
    .select('engagement_untouched_deals, week_start, week_end')
    .eq('fiscal_year', year)
    .eq('fiscal_quarter', quarter)
    .eq('week_number', weekNumber);

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  } else {
    query = query.is('owner_id', null);
  }

  const { data: snapshots, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const snapshot = snapshots?.[0];
  if (!snapshot) {
    return NextResponse.json({
      deals: [],
      weekLabel: `Week ${weekNumber}`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = (snapshot.engagement_untouched_deals as any[]) || [];

  return NextResponse.json({
    deals,
    weekLabel: `Week ${weekNumber} (${snapshot.week_start} – ${snapshot.week_end})`,
  });
}
