import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { createServiceClient } from '@/lib/supabase/client';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (user.role !== 'vp_revops') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 365);

  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await supabase
    .from('analysis_usage_log')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching analysis usage:', error);
    return NextResponse.json({ error: 'Failed to fetch usage data' }, { status: 500 });
  }

  // Aggregate by user
  const byUser = new Map<string, {
    userId: string;
    email: string;
    displayName: string | null;
    count: number;
    totalTokens: number;
    lastAnalysis: string;
  }>();

  for (const log of logs || []) {
    const key = log.user_id;
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: log.user_id,
        email: log.user_email,
        displayName: log.user_display_name,
        count: 0,
        totalTokens: 0,
        lastAnalysis: log.created_at,
      });
    }
    const entry = byUser.get(key)!;
    entry.count++;
    entry.totalTokens += log.total_tokens || 0;
    if (log.created_at > entry.lastAnalysis) {
      entry.lastAnalysis = log.created_at;
    }
  }

  return NextResponse.json({
    logs: logs || [],
    summary: Array.from(byUser.values()),
    period: { days, since },
  });
}
