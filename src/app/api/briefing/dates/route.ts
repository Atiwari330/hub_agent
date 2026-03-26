import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.MORNING_BRIEFING);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('morning_briefing_runs')
    .select('run_date, status, sync_status')
    .order('run_date', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dates: data || [] });
}
