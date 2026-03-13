import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

const DEMO_TRACKER_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
  (e) => e !== 'atiwari@opusbehavioral.com'
);

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.DEMO_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));

  if (quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
  }

  // Resolve allowed owner IDs
  const { data: allowedOwners } = await supabase
    .from('owners')
    .select('id')
    .in('email', [...DEMO_TRACKER_AE_EMAILS]);

  const allowedOwnerIds = new Set((allowedOwners || []).map((o) => o.id as string));

  // Fetch snapshots
  const { data: snapshots, error } = await supabase
    .from('demo_tracker_snapshots')
    .select('*')
    .eq('fiscal_year', year)
    .eq('fiscal_quarter', quarter)
    .order('week_number', { ascending: true })
    .order('owner_id', { ascending: true, nullsFirst: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filtered = (snapshots || []).filter(
    (s) => s.owner_id === null || allowedOwnerIds.has(s.owner_id)
  );

  // Fetch owner names
  const ownerIds = [...new Set(filtered.filter((s) => s.owner_id).map((s) => s.owner_id!))];
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .in('id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

  const ownerNameMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );

  const lastComputed = filtered.length > 0
    ? filtered.reduce((latest, s) => {
        const ct = new Date(s.computed_at).getTime();
        return ct > latest ? ct : latest;
      }, 0)
    : null;

  // Build week-oriented response
  const weekMap = new Map<number, {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    team: { demosScheduled: number; demosCompleted: number };
    byAE: { ownerId: string; ownerName: string; demosScheduled: number; demosCompleted: number }[];
  }>();

  for (const snap of filtered) {
    if (!weekMap.has(snap.week_number)) {
      weekMap.set(snap.week_number, {
        weekNumber: snap.week_number,
        weekStart: snap.week_start,
        weekEnd: snap.week_end,
        team: { demosScheduled: 0, demosCompleted: 0 },
        byAE: [],
      });
    }

    const week = weekMap.get(snap.week_number)!;

    if (snap.owner_id === null) {
      week.team = {
        demosScheduled: snap.demos_scheduled,
        demosCompleted: snap.demos_completed,
      };
    } else {
      week.byAE.push({
        ownerId: snap.owner_id,
        ownerName: ownerNameMap.get(snap.owner_id) || 'Unknown',
        demosScheduled: snap.demos_scheduled,
        demosCompleted: snap.demos_completed,
      });
    }
  }

  return NextResponse.json({
    quarter: { year, quarter, label: `Q${quarter} ${year}` },
    lastComputed: lastComputed ? new Date(lastComputed).toISOString() : null,
    weeks: Array.from(weekMap.values()).sort((a, b) => a.weekNumber - b.weekNumber),
  });
}
