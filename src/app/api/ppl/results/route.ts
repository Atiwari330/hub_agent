import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get('ownerId');
  const verdict = searchParams.get('verdict');
  const riskOnly = searchParams.get('riskOnly') === 'true';

  const supabase = createServiceClient();

  let query = supabase
    .from('ppl_cadence_latest')
    .select('*')
    .order('analyzed_at', { ascending: false });

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  }
  if (verdict) {
    query = query.eq('verdict', verdict);
  }
  if (riskOnly) {
    query = query.or('risk_flag.eq.true,engagement_risk.eq.true');
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = data || [];

  // Build summary stats
  const summary = {
    totalDeals: results.length,
    byVerdict: {} as Record<string, number>,
    riskCount: results.filter((r) => r.risk_flag).length,
    engagementRiskCount: results.filter((r) => r.engagement_risk).length,
    lastAnalyzedAt: results.length > 0 ? results[0].analyzed_at : null,
  };

  for (const r of results) {
    summary.byVerdict[r.verdict] = (summary.byVerdict[r.verdict] || 0) + 1;
  }

  // Get distinct owners for AE filter
  const owners = Array.from(
    new Map(
      results
        .filter((r) => r.owner_id && r.owner_name)
        .map((r) => [r.owner_id, { id: r.owner_id, name: r.owner_name }])
    ).values()
  );

  return NextResponse.json({ results, summary, owners });
}
