import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export interface TrendCategory {
  name: string;
  total: number;
  byPeriod: { period: string; count: number }[];
}

export interface TrendsResponse {
  categories: TrendCategory[];
  periods: string[];
}

/**
 * GET /api/queues/support-intel/trends
 *
 * Returns aggregated category trend data for the ticket categorizations.
 * Query params:
 *   - period: 'weekly' | 'monthly' (default: 'weekly')
 *   - weeks: number of weeks to look back (default: 8)
 *   - category: optional filter to a specific category
 */
export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_INTEL);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'weekly';
  const weeks = parseInt(searchParams.get('weeks') || '8', 10);
  const categoryFilter = searchParams.get('category');

  const supabase = await createServerSupabaseClient();

  try {
    // Calculate the start date
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);

    // Fetch all categorizations within the time range
    let query = supabase
      .from('ticket_categorizations')
      .select('primary_category, ticket_created_at')
      .gte('ticket_created_at', startDate.toISOString())
      .not('ticket_created_at', 'is', null);

    if (categoryFilter) {
      query = query.ilike('primary_category', categoryFilter);
    }

    const { data: rows, error } = await query;

    if (error) {
      console.error('Error fetching trend data:', error);
      return NextResponse.json(
        { error: 'Failed to fetch trend data', details: error.message },
        { status: 500 }
      );
    }

    // Generate period buckets
    const periods: string[] = [];
    const periodStart = new Date(startDate);
    const now = new Date();

    if (period === 'monthly') {
      periodStart.setDate(1);
      while (periodStart <= now) {
        periods.push(periodStart.toISOString().slice(0, 7)); // YYYY-MM
        periodStart.setMonth(periodStart.getMonth() + 1);
      }
    } else {
      // Weekly - align to Monday
      const day = periodStart.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      periodStart.setDate(periodStart.getDate() + diff);
      while (periodStart <= now) {
        periods.push(periodStart.toISOString().slice(0, 10)); // YYYY-MM-DD (Monday)
        periodStart.setDate(periodStart.getDate() + 7);
      }
    }

    // Aggregate: category -> period -> count
    const categoryMap: Record<string, Record<string, number>> = {};

    for (const row of rows || []) {
      const cat = row.primary_category;
      const created = new Date(row.ticket_created_at);

      let bucket: string;
      if (period === 'monthly') {
        bucket = created.toISOString().slice(0, 7);
      } else {
        // Find the Monday of the week
        const d = new Date(created);
        const dayOfWeek = d.getDay();
        const mondayDiff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        d.setDate(d.getDate() + mondayDiff);
        bucket = d.toISOString().slice(0, 10);
      }

      if (!categoryMap[cat]) categoryMap[cat] = {};
      categoryMap[cat][bucket] = (categoryMap[cat][bucket] || 0) + 1;
    }

    // Build response
    const categories: TrendCategory[] = Object.entries(categoryMap)
      .map(([name, periodCounts]) => {
        const total = Object.values(periodCounts).reduce((sum, c) => sum + c, 0);
        const byPeriod = periods.map((p) => ({
          period: p,
          count: periodCounts[p] || 0,
        }));
        return { name, total, byPeriod };
      })
      .sort((a, b) => b.total - a.total);

    const response: TrendsResponse = { categories, periods };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Support intel trends error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get trend data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
