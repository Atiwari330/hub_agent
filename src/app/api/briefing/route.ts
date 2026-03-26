import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';

export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.MORNING_BRIEFING);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  const supabase = await createServerSupabaseClient();

  // Fetch run — either by date or latest
  let runQuery = supabase
    .from('morning_briefing_runs')
    .select('*');

  if (date) {
    runQuery = runQuery.eq('run_date', date);
  } else {
    runQuery = runQuery.order('run_date', { ascending: false }).limit(1);
  }

  const { data: runs, error: runError } = await runQuery;

  if (runError) {
    return NextResponse.json({ error: runError.message }, { status: 500 });
  }

  if (!runs || runs.length === 0) {
    return NextResponse.json({ run: null, sections: [] });
  }

  const run = runs[0];

  // Fetch sections for this run
  const { data: sections, error: sectionsError } = await supabase
    .from('morning_briefing_sections')
    .select('*')
    .eq('run_id', run.id)
    .order('created_at', { ascending: true });

  if (sectionsError) {
    return NextResponse.json({ error: sectionsError.message }, { status: 500 });
  }

  return NextResponse.json({
    run,
    sections: sections || [],
  });
}
