import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// Hot Tracker excludes Adi Tiwari — same filter as compute.ts
const HOT_TRACKER_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
  (e) => e !== 'atiwari@opusbehavioral.com'
);

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));

  if (quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
  }

  // Resolve allowed owner IDs from the Hot Tracker AE email list
  const { data: allowedOwners } = await supabase
    .from('owners')
    .select('id')
    .in('email', [...HOT_TRACKER_AE_EMAILS]);

  const allowedOwnerIds = new Set((allowedOwners || []).map((o) => o.id as string));

  // Fetch all snapshot rows for this quarter
  const { data: snapshots, error } = await supabase
    .from('hot_tracker_snapshots')
    .select('*')
    .eq('fiscal_year', year)
    .eq('fiscal_quarter', quarter)
    .order('week_number', { ascending: true })
    .order('owner_id', { ascending: true, nullsFirst: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter snapshots to only team totals (owner_id null) and allowed AEs
  const filtered = (snapshots || []).filter(
    (s) => s.owner_id === null || allowedOwnerIds.has(s.owner_id)
  );

  // Fetch owner names
  const ownerIds = [...new Set(filtered.filter((s) => s.owner_id).map((s) => s.owner_id!))];
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name, hubspot_owner_id')
    .in('id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

  const ownerNameMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );

  // Get last computed timestamp
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
    team: {
      sqlContactedPct: number;
      sqlContacted: number;
      sqlTotal: number;
      callsToSqlWithPhone: number;
      proposalWithGift: number;
      proposalTotal: number;
      sqlDealDetails: unknown[];
    };
    byAE: {
      ownerId: string;
      ownerName: string;
      sqlContactedPct: number;
      sqlContacted: number;
      sqlTotal: number;
      callsToSqlWithPhone: number;
      proposalWithGift: number;
      proposalTotal: number;
    }[];
  }>();

  for (const snap of filtered) {
    if (!weekMap.has(snap.week_number)) {
      weekMap.set(snap.week_number, {
        weekNumber: snap.week_number,
        weekStart: snap.week_start,
        weekEnd: snap.week_end,
        team: {
          sqlContactedPct: 0,
          sqlContacted: 0,
          sqlTotal: 0,
          callsToSqlWithPhone: 0,
          proposalWithGift: 0,
          proposalTotal: 0,
          sqlDealDetails: [],
        },
        byAE: [],
      });
    }

    const week = weekMap.get(snap.week_number)!;

    if (snap.owner_id === null) {
      // Team total row
      week.team = {
        sqlContactedPct: snap.sql_deals_count > 0 ? snap.sql_contacted_15min / snap.sql_deals_count : 0,
        sqlContacted: snap.sql_contacted_15min,
        sqlTotal: snap.sql_deals_count,
        callsToSqlWithPhone: snap.calls_to_sql_with_phone,
        proposalWithGift: snap.proposal_deals_with_gift,
        proposalTotal: snap.proposal_deals_count,
        sqlDealDetails: snap.sql_deal_details || [],
      };
    } else {
      // Per-AE row
      week.byAE.push({
        ownerId: snap.owner_id,
        ownerName: ownerNameMap.get(snap.owner_id) || 'Unknown',
        sqlContactedPct: snap.sql_deals_count > 0 ? snap.sql_contacted_15min / snap.sql_deals_count : 0,
        sqlContacted: snap.sql_contacted_15min,
        sqlTotal: snap.sql_deals_count,
        callsToSqlWithPhone: snap.calls_to_sql_with_phone,
        proposalWithGift: snap.proposal_deals_with_gift,
        proposalTotal: snap.proposal_deals_count,
      });
    }
  }

  return NextResponse.json({
    quarter: { year, quarter, label: `Q${quarter} ${year}` },
    lastComputed: lastComputed ? new Date(lastComputed).toISOString() : null,
    goals: {
      sqlContactedPct: 1.0,
      callsToSqlWithPhone: 180,
      proposalWithGift: 4,
    },
    weeks: Array.from(weekMap.values()).sort((a, b) => a.weekNumber - b.weekNumber),
  });
}
