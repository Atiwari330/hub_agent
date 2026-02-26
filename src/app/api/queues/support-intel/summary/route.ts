import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';

export interface SupportIntelSummary {
  id: string;
  period_start: string;
  period_end: string;
  period_type: string;
  summary_text: string;
  top_categories: Array<{ category: string; count: number; pctChange: number | null }>;
  emerging_issues: Array<{ category: string; count: number }> | null;
  declining_issues: Array<{ category: string; count: number }> | null;
  key_insights: string[] | null;
  total_tickets_analyzed: number;
  new_tickets_in_period: number;
  generated_at: string;
}

/**
 * GET /api/queues/support-intel/summary
 *
 * Fetch the most recent summary.
 */
export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_INTEL);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const periodType = searchParams.get('periodType') || 'weekly';

  const supabase = await createServerSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('support_intel_summaries')
      .select('*')
      .eq('period_type', periodType)
      .order('period_end', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json(
        { error: 'Failed to fetch summary', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ summary: data || null });
  } catch (error) {
    console.error('Support intel summary fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/queues/support-intel/summary
 *
 * Generate an executive summary for a date range.
 * Body: { periodStart: string, periodEnd: string }
 */
export async function POST(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_INTEL);
  if (authResult instanceof NextResponse) return authResult;

  let body: { periodStart: string; periodEnd: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { periodStart, periodEnd } = body;
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: 'periodStart and periodEnd are required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();

  try {
    // Fetch categorizations in the current period
    const { data: currentRows, error: currentError } = await supabase
      .from('ticket_categorizations')
      .select('*')
      .gte('ticket_created_at', periodStart)
      .lte('ticket_created_at', periodEnd);

    if (currentError) {
      return NextResponse.json(
        { error: 'Failed to fetch categorizations', details: currentError.message },
        { status: 500 }
      );
    }

    // Fetch previous period for comparison
    const periodMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
    const prevStart = new Date(new Date(periodStart).getTime() - periodMs).toISOString();
    const prevEnd = periodStart;

    const { data: prevRows } = await supabase
      .from('ticket_categorizations')
      .select('primary_category')
      .gte('ticket_created_at', prevStart)
      .lte('ticket_created_at', prevEnd);

    // Aggregate current period categories
    const currentCats: Record<string, number> = {};
    for (const row of currentRows || []) {
      currentCats[row.primary_category] = (currentCats[row.primary_category] || 0) + 1;
    }

    // Aggregate previous period categories
    const prevCats: Record<string, number> = {};
    for (const row of prevRows || []) {
      prevCats[row.primary_category] = (prevCats[row.primary_category] || 0) + 1;
    }

    // Top categories with % change
    const topCategories = Object.entries(currentCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([category, count]) => {
        const prevCount = prevCats[category] || 0;
        const pctChange = prevCount > 0
          ? Math.round(((count - prevCount) / prevCount) * 100)
          : null;
        return { category, count, pctChange };
      });

    // Emerging issues (in current but not/barely in previous)
    const emerging = Object.entries(currentCats)
      .filter(([cat, count]) => {
        const prev = prevCats[cat] || 0;
        return count >= 2 && (prev === 0 || count / prev >= 2);
      })
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Declining issues (in previous but reduced in current)
    const declining = Object.entries(prevCats)
      .filter(([cat, prevCount]) => {
        const curr = currentCats[cat] || 0;
        return prevCount >= 2 && curr < prevCount * 0.5;
      })
      .map(([category]) => ({ category, count: currentCats[category] || 0 }))
      .slice(0, 5);

    // Severity breakdown
    const severityCounts: Record<string, number> = {};
    const issueTypeCounts: Record<string, number> = {};
    for (const row of currentRows || []) {
      severityCounts[row.severity] = (severityCounts[row.severity] || 0) + 1;
      issueTypeCounts[row.issue_type] = (issueTypeCounts[row.issue_type] || 0) + 1;
    }

    // Generate LLM summary
    const summaryPrompt = `You are a VP of Support Operations at a healthcare SaaS company.
Generate a brief executive summary of support trends for the period ${periodStart} to ${periodEnd}.

DATA:
- Total tickets analyzed: ${(currentRows || []).length}
- Previous period tickets: ${(prevRows || []).length}

Top categories (current period):
${topCategories.map((c) => `  - ${c.category}: ${c.count} tickets${c.pctChange !== null ? ` (${c.pctChange > 0 ? '+' : ''}${c.pctChange}% vs prev)` : ' (new)'}`).join('\n')}

Severity breakdown:
${Object.entries(severityCounts).map(([s, c]) => `  - ${s}: ${c}`).join('\n')}

Issue type breakdown:
${Object.entries(issueTypeCounts).map(([t, c]) => `  - ${t}: ${c}`).join('\n')}

${emerging.length > 0 ? `Emerging issues (new or spiking):\n${emerging.map((e) => `  - ${e.category}: ${e.count} tickets`).join('\n')}` : 'No emerging issues detected.'}

${declining.length > 0 ? `Declining issues (trending down):\n${declining.map((d) => `  - ${d.category}: ${d.count} tickets`).join('\n')}` : ''}

Write a 3-5 paragraph executive summary that:
1. Highlights the top 2-3 things leadership needs to know
2. Notes any concerning trends or improvements
3. Suggests 1-2 actionable focus areas
4. Is written in plain English, not bullet points

Also provide 3-5 key insights as a JSON array of strings at the end, on its own line prefixed with KEY_INSIGHTS:`;

    const result = await generateText({
      model: getModel(),
      prompt: summaryPrompt,
    });

    const fullText = result.text;
    const insightsMatch = fullText.match(/KEY_INSIGHTS:\s*(\[[\s\S]*\])/i);
    let keyInsights: string[] | null = null;
    let summaryText = fullText;

    if (insightsMatch) {
      try {
        keyInsights = JSON.parse(insightsMatch[1]);
        summaryText = fullText.slice(0, insightsMatch.index).trim();
      } catch {
        // If JSON parsing fails, keep the full text
      }
    }

    // Store the summary
    const summaryData = {
      period_start: periodStart,
      period_end: periodEnd,
      period_type: 'weekly',
      summary_text: summaryText,
      top_categories: topCategories,
      emerging_issues: emerging.length > 0 ? emerging : null,
      declining_issues: declining.length > 0 ? declining : null,
      key_insights: keyInsights,
      total_tickets_analyzed: (currentRows || []).length,
      new_tickets_in_period: (currentRows || []).length,
      generated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('support_intel_summaries')
      .upsert(summaryData, { onConflict: 'period_start,period_end,period_type' });

    if (upsertError) {
      console.error('Error upserting summary:', upsertError);
    }

    return NextResponse.json({ summary: summaryData });
  } catch (error) {
    console.error('Support intel summary generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
