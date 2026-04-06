import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get('ownerId');
  const status = searchParams.get('status');

  const supabase = createServiceClient();

  let query = supabase
    .from('pricing_compliance_latest')
    .select('*')
    .order('analyzed_at', { ascending: false });

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  }
  if (status) {
    query = query.eq('compliance_status', status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  interface PricingRow {
    compliance_status: string;
    owner_id: string | null;
    owner_name: string | null;
    analyzed_at: string;
    [key: string]: unknown;
  }

  const results: PricingRow[] = data || [];

  // Build summary stats
  const byStatus: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.compliance_status] = (byStatus[r.compliance_status] || 0) + 1;
  }

  const scored = results.filter((r) => r.compliance_status !== 'PENDING');
  const compliant = results.filter(
    (r) => r.compliance_status === 'COMPLIANT' || r.compliance_status === 'EXEMPT'
  ).length;

  const summary = {
    totalDeals: results.length,
    byStatus,
    complianceRate: scored.length > 0 ? compliant / scored.length : null,
    nonCompliantCount: byStatus['NON_COMPLIANT'] || 0,
    lastAnalyzedAt: results.length > 0 ? results[0].analyzed_at : null,
  };

  // Get distinct owners for filter
  const owners = Array.from(
    new Map(
      results
        .filter((r) => r.owner_id && r.owner_name)
        .map((r) => [r.owner_id, { id: r.owner_id, name: r.owner_name }])
    ).values()
  );

  return NextResponse.json({ results, summary, owners });
}
