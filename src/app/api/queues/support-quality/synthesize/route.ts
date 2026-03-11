import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { generateText } from 'ai';
import { getOpusModel } from '@/lib/ai/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

interface QualityRow {
  hubspot_ticket_id: string;
  overall_quality_score: number;
  quality_grade: string;
  rep_competence_score: number;
  communication_score: number;
  resolution_score: number;
  efficiency_score: number;
  customer_sentiment: string;
  resolution_status: string;
  handling_quality: string;
  key_observations: string;
  improvement_areas: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  is_closed: boolean;
  primary_category: string | null;
  severity: string | null;
  assigned_rep: string | null;
  confidence: number;
}

export interface SynthesisReport {
  executiveSummary: string;
  categoryBreakdown: {
    category: string;
    count: number;
    pct: string;
    avgScore: number;
    topIssue: string;
  }[];
  repPerformance: {
    rep: string;
    tickets: number;
    avgScore: number;
    grade: string;
    strengths: string;
    weaknesses: string;
  }[];
  qualityPatterns: {
    pattern: string;
    frequency: string;
    impact: string;
    evidence: string;
  }[];
  trainingRecommendations: {
    priority: string;
    recommendation: string;
    target: string;
    evidence: string;
    expectedImpact: string;
  }[];
  sopRecommendations: {
    priority: string;
    sop: string;
    gap: string;
    evidence: string;
  }[];
  policyGaps: {
    gap: string;
    impact: string;
    evidence: string;
    recommendation: string;
  }[];
  focusAreas: {
    timeframe: string;
    focus: string;
    why: string;
    metric: string;
  }[];
  stats: {
    totalTickets: number;
    gradeDistribution: Record<string, number>;
    avgScore: number;
    sentimentDistribution: Record<string, number>;
    resolutionDistribution: Record<string, number>;
    avgDimensions: {
      repCompetence: number;
      communication: number;
      resolution: number;
      efficiency: number;
    };
  };
  analyzedAt: string;
}

// --- Company Context (shared with support-pulse) ---

const COMPANY_CONTEXT = `
Team Roles & Responsibilities:
- VP of Support: Owns overall support strategy, escalation authority, SLA accountability
- Support Manager: Day-to-day ticket triage, team workload balancing, process enforcement
- Support Engineers: Front-line ticket resolution, customer communication
- Engineering Team: Bug fixes, feature requests, technical escalations (tracked via Linear)
- Customer Success Managers (CSMs): Account relationship owners, renewal risk mitigation
- VP of RevOps: Revenue operations, cross-functional process optimization

Escalation Paths:
- SLA breach → Support Manager → VP of Support
- Engineering escalation → Linear task → Engineering Lead
- Account risk (high ARR + multiple issues) → CSM + VP of Support
- Recurring product issues → Engineering Lead + Product Manager
- Training gaps → Support Manager + VP of Support
`.trim();

// --- Compress individual analysis for aggregate prompt ---

function compressAnalysis(row: QualityRow): string {
  const scores = `Rep:${row.rep_competence_score} Comm:${row.communication_score} Res:${row.resolution_score} Eff:${row.efficiency_score}`;
  const lines = [
    `[${row.hubspot_ticket_id}] ${row.ticket_subject || 'No subject'} | ${row.company_name || 'Unknown'} | Rep: ${row.assigned_rep || 'Unassigned'}`,
    `  Grade:${row.quality_grade} Score:${row.overall_quality_score} | ${scores} | Sentiment:${row.customer_sentiment} | Resolution:${row.resolution_status}`,
  ];
  if (row.primary_category) {
    lines.push(`  Category: ${row.primary_category} | Severity: ${row.severity || 'Unknown'}`);
  }
  // Compress observations to a single line
  const obsOneLine = row.key_observations
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean)
    .join('; ');
  if (obsOneLine) {
    lines.push(`  Obs: ${obsOneLine}`);
  }
  if (row.improvement_areas) {
    const improvOneLine = row.improvement_areas
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean)
      .join('; ');
    lines.push(`  Improve: ${improvOneLine}`);
  }
  return lines.join('\n');
}

// --- Pre-compute summary statistics ---

function computeStats(rows: QualityRow[]) {
  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const sentimentDistribution: Record<string, number> = {};
  const resolutionDistribution: Record<string, number> = {};
  const repStats: Record<string, { tickets: number; totalScore: number; grades: Record<string, number> }> = {};
  const catStats: Record<string, { tickets: number; totalScore: number }> = {};

  let totalScore = 0;
  let totalRep = 0;
  let totalComm = 0;
  let totalRes = 0;
  let totalEff = 0;

  for (const row of rows) {
    // Grade
    gradeDistribution[row.quality_grade] = (gradeDistribution[row.quality_grade] || 0) + 1;

    // Sentiment
    sentimentDistribution[row.customer_sentiment] =
      (sentimentDistribution[row.customer_sentiment] || 0) + 1;

    // Resolution
    resolutionDistribution[row.resolution_status] =
      (resolutionDistribution[row.resolution_status] || 0) + 1;

    // Scores
    totalScore += row.overall_quality_score;
    totalRep += row.rep_competence_score;
    totalComm += row.communication_score;
    totalRes += row.resolution_score;
    totalEff += row.efficiency_score;

    // Per-rep
    const rep = row.assigned_rep || 'Unassigned';
    if (!repStats[rep]) repStats[rep] = { tickets: 0, totalScore: 0, grades: {} };
    repStats[rep].tickets++;
    repStats[rep].totalScore += row.overall_quality_score;
    repStats[rep].grades[row.quality_grade] = (repStats[rep].grades[row.quality_grade] || 0) + 1;

    // Per-category
    const cat = row.primary_category || 'Uncategorized';
    if (!catStats[cat]) catStats[cat] = { tickets: 0, totalScore: 0 };
    catStats[cat].tickets++;
    catStats[cat].totalScore += row.overall_quality_score;
  }

  const n = rows.length || 1;

  return {
    totalTickets: rows.length,
    gradeDistribution,
    avgScore: Math.round(totalScore / n),
    sentimentDistribution,
    resolutionDistribution,
    avgDimensions: {
      repCompetence: parseFloat((totalRep / n).toFixed(1)),
      communication: parseFloat((totalComm / n).toFixed(1)),
      resolution: parseFloat((totalRes / n).toFixed(1)),
      efficiency: parseFloat((totalEff / n).toFixed(1)),
    },
    repStats,
    catStats,
  };
}

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are a senior support operations strategist for Opus Behavioral Health, a healthcare SaaS company.

You have received quality analyses for support tickets. Each analysis includes quality scores (rep competence, communication, resolution, efficiency on a 0-10 scale), customer sentiment, resolution status, key observations, and improvement areas.

Your job is to synthesize these individual analyses into strategic, evidence-based recommendations for the VP of Support and VP of RevOps.

${COMPANY_CONTEXT}

Respond in the following structured format. Use the exact section headers and delimiters shown below.

===EXECUTIVE_SUMMARY===
3-5 sentences summarizing the overall support quality picture. Include the average quality score, the distribution of grades, and the most significant pattern you identified.

===CATEGORY_BREAKDOWN===
List each ticket category, one per line:
CATEGORY: name | COUNT: N | PCT: X% | AVG_SCORE: Y | TOP_ISSUE: brief description of the most common quality issue in this category

Order by count descending.

===REP_PERFORMANCE===
List each support rep, one per line:
REP: name | TICKETS: N | AVG_SCORE: Y | GRADE: X | STRENGTHS: brief | WEAKNESSES: brief

Order by ticket volume descending.

===QUALITY_PATTERNS===
List the top 5-10 quality patterns observed, one per line:
PATTERN: description | FREQUENCY: how often (e.g., "12 of 45 tickets") | IMPACT: high/medium/low | EVIDENCE: specific ticket references (IDs)

Patterns to look for:
- Common communication failures (late follow-ups, unclear instructions, lack of empathy)
- Recurring resolution issues (workarounds instead of fixes, premature closures)
- Routing inefficiencies (wrong team assignments, excessive handoffs)
- Knowledge gaps (specific product areas where reps struggle)
- Process gaps (missing SLA tracking, inconsistent escalation)

===TRAINING_RECOMMENDATIONS===
Prioritized training recommendations, one per line:
PRIORITY: critical|high|medium | RECOMMENDATION: what training is needed | TARGET: who should receive it | EVIDENCE: ticket IDs/examples | EXPECTED_IMPACT: what improvement this would drive

Include 3-8 recommendations ranked by impact.

===SOP_RECOMMENDATIONS===
Recommended standard operating procedures, one per line:
PRIORITY: critical|high|medium | SOP: title/description of the SOP | GAP: what gap this addresses | EVIDENCE: ticket IDs/examples showing the need

Include 2-5 SOP recommendations.

===POLICY_GAPS===
Identified policy or procedure gaps, one per line:
GAP: description | IMPACT: how this affects support quality | EVIDENCE: ticket IDs/examples | RECOMMENDATION: suggested policy change

Include 1-5 gaps if identified. If none, write "No policy gaps identified."

===FOCUS_AREAS===
Top 3 focus areas for the next 30/60/90 days, one per line:
TIMEFRAME: 30d|60d|90d | FOCUS: what to focus on | WHY: why this matters now | METRIC: how to measure improvement

Guidelines:
- Be SPECIFIC — cite actual ticket IDs, rep names, categories, and metrics
- Back EVERY recommendation with evidence from the ticket data
- Prioritize by business impact
- Focus on actionable items, not observations
- High-severity tickets with quality issues deserve more weight
- Patterns across multiple tickets are more significant than one-off issues
- Consider both what went wrong AND what went right — acknowledge strong performers`;
}

// --- User Prompt ---

function buildUserPrompt(rows: QualityRow[]): string {
  const stats = computeStats(rows);
  const lines: string[] = [];

  lines.push(`Analyze the following ${rows.length} ticket quality assessments and produce strategic recommendations.\n`);

  // Summary stats
  lines.push('=== SUMMARY STATISTICS ===');
  lines.push(`Total Tickets: ${stats.totalTickets}`);
  lines.push(
    `Grade Distribution: A:${stats.gradeDistribution.A || 0} B:${stats.gradeDistribution.B || 0} C:${stats.gradeDistribution.C || 0} D:${stats.gradeDistribution.D || 0} F:${stats.gradeDistribution.F || 0}`
  );
  lines.push(`Average Quality Score: ${stats.avgScore}/100`);

  const sentEntries = Object.entries(stats.sentimentDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`Sentiment Distribution: ${sentEntries.join(' ')}`);

  const resEntries = Object.entries(stats.resolutionDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`Resolution Distribution: ${resEntries.join(' ')}`);

  lines.push(
    `Avg Dimension Scores: Rep Competence:${stats.avgDimensions.repCompetence} Communication:${stats.avgDimensions.communication} Resolution:${stats.avgDimensions.resolution} Efficiency:${stats.avgDimensions.efficiency}`
  );
  lines.push('');

  // By rep
  lines.push('=== BY REP (pre-computed) ===');
  const repEntries = Object.entries(stats.repStats)
    .sort((a, b) => b[1].tickets - a[1].tickets);
  for (const [rep, data] of repEntries) {
    const avg = Math.round(data.totalScore / data.tickets);
    const gradeDist = Object.entries(data.grades)
      .map(([g, c]) => `${g}:${c}`)
      .join(' ');
    lines.push(`${rep} | tickets:${data.tickets} | avg_score:${avg} | grades: ${gradeDist}`);
  }
  lines.push('');

  // By category
  lines.push('=== BY CATEGORY (pre-computed) ===');
  const catEntries = Object.entries(stats.catStats)
    .sort((a, b) => b[1].tickets - a[1].tickets);
  for (const [cat, data] of catEntries) {
    const avg = Math.round(data.totalScore / data.tickets);
    const pct = ((data.tickets / stats.totalTickets) * 100).toFixed(1);
    lines.push(`${cat} | tickets:${data.tickets} | pct:${pct}% | avg_score:${avg}`);
  }
  lines.push('');

  // Individual ticket analyses (compressed)
  lines.push('=== INDIVIDUAL TICKET ANALYSES ===');
  for (const row of rows) {
    lines.push(compressAnalysis(row));
  }

  return lines.join('\n');
}

// --- Response Parsing ---

function parseSynthesisResponse(text: string, rows: QualityRow[]): SynthesisReport {
  const stats = computeStats(rows);

  // Extract sections
  const summaryMatch = text.match(/===EXECUTIVE_SUMMARY===([\s\S]*?)(?====|$)/);
  const catMatch = text.match(/===CATEGORY_BREAKDOWN===([\s\S]*?)(?====|$)/);
  const repMatch = text.match(/===REP_PERFORMANCE===([\s\S]*?)(?====|$)/);
  const patternsMatch = text.match(/===QUALITY_PATTERNS===([\s\S]*?)(?====|$)/);
  const trainingMatch = text.match(/===TRAINING_RECOMMENDATIONS===([\s\S]*?)(?====|$)/);
  const sopMatch = text.match(/===SOP_RECOMMENDATIONS===([\s\S]*?)(?====|$)/);
  const policyMatch = text.match(/===POLICY_GAPS===([\s\S]*?)(?====|$)/);
  const focusMatch = text.match(/===FOCUS_AREAS===([\s\S]*?)(?====|$)/);

  // Parse executive summary
  const executiveSummary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Parse category breakdown
  const categoryBreakdown: SynthesisReport['categoryBreakdown'] = [];
  if (catMatch) {
    const catLines = catMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of catLines) {
      const catM = line.match(/CATEGORY:\s*([^|]+)/i);
      const countM = line.match(/COUNT:\s*(\d+)/i);
      const pctM = line.match(/PCT:\s*([\d.]+)%?/i);
      const avgM = line.match(/AVG_SCORE:\s*([\d.]+)/i);
      const issueM = line.match(/TOP_ISSUE:\s*(.+)/i);
      if (catM) {
        categoryBreakdown.push({
          category: catM[1].trim(),
          count: countM ? parseInt(countM[1]) : 0,
          pct: pctM ? `${pctM[1]}%` : '0%',
          avgScore: avgM ? parseFloat(avgM[1]) : 0,
          topIssue: issueM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse rep performance
  const repPerformance: SynthesisReport['repPerformance'] = [];
  if (repMatch) {
    const repLines = repMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of repLines) {
      const repM = line.match(/REP:\s*([^|]+)/i);
      const ticketsM = line.match(/TICKETS:\s*(\d+)/i);
      const avgM = line.match(/AVG_SCORE:\s*([\d.]+)/i);
      const gradeM = line.match(/GRADE:\s*([ABCDF])/i);
      const strengthsM = line.match(/STRENGTHS:\s*([^|]+)/i);
      const weaknessesM = line.match(/WEAKNESSES:\s*(.+)/i);
      if (repM) {
        repPerformance.push({
          rep: repM[1].trim(),
          tickets: ticketsM ? parseInt(ticketsM[1]) : 0,
          avgScore: avgM ? parseFloat(avgM[1]) : 0,
          grade: gradeM?.[1] || 'C',
          strengths: strengthsM?.[1]?.trim() || '',
          weaknesses: weaknessesM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse quality patterns
  const qualityPatterns: SynthesisReport['qualityPatterns'] = [];
  if (patternsMatch) {
    const patLines = patternsMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of patLines) {
      const patM = line.match(/PATTERN:\s*([^|]+)/i);
      const freqM = line.match(/FREQUENCY:\s*([^|]+)/i);
      const impactM = line.match(/IMPACT:\s*([^|]+)/i);
      const evidenceM = line.match(/EVIDENCE:\s*(.+)/i);
      if (patM) {
        qualityPatterns.push({
          pattern: patM[1].trim(),
          frequency: freqM?.[1]?.trim() || '',
          impact: impactM?.[1]?.trim() || 'medium',
          evidence: evidenceM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse training recommendations
  const trainingRecommendations: SynthesisReport['trainingRecommendations'] = [];
  if (trainingMatch) {
    const trainLines = trainingMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of trainLines) {
      const priM = line.match(/PRIORITY:\s*(critical|high|medium)/i);
      const recM = line.match(/RECOMMENDATION:\s*([^|]+)/i);
      const targetM = line.match(/TARGET:\s*([^|]+)/i);
      const evidenceM = line.match(/EVIDENCE:\s*([^|]+)/i);
      const impactM = line.match(/EXPECTED_IMPACT:\s*(.+)/i);
      if (priM && recM) {
        trainingRecommendations.push({
          priority: priM[1].toLowerCase(),
          recommendation: recM[1].trim(),
          target: targetM?.[1]?.trim() || 'Support team',
          evidence: evidenceM?.[1]?.trim() || '',
          expectedImpact: impactM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse SOP recommendations
  const sopRecommendations: SynthesisReport['sopRecommendations'] = [];
  if (sopMatch) {
    const sopLines = sopMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of sopLines) {
      const priM = line.match(/PRIORITY:\s*(critical|high|medium)/i);
      const sopM = line.match(/SOP:\s*([^|]+)/i);
      const gapM = line.match(/GAP:\s*([^|]+)/i);
      const evidenceM = line.match(/EVIDENCE:\s*(.+)/i);
      if (priM && sopM) {
        sopRecommendations.push({
          priority: priM[1].toLowerCase(),
          sop: sopM[1].trim(),
          gap: gapM?.[1]?.trim() || '',
          evidence: evidenceM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse policy gaps
  const policyGaps: SynthesisReport['policyGaps'] = [];
  if (policyMatch) {
    const polText = policyMatch[1].trim();
    if (!polText.toLowerCase().includes('no policy gaps')) {
      const polLines = polText.split('\n').filter((l) => l.trim());
      for (const line of polLines) {
        const gapM = line.match(/GAP:\s*([^|]+)/i);
        const impactM = line.match(/IMPACT:\s*([^|]+)/i);
        const evidenceM = line.match(/EVIDENCE:\s*([^|]+)/i);
        const recM = line.match(/RECOMMENDATION:\s*(.+)/i);
        if (gapM) {
          policyGaps.push({
            gap: gapM[1].trim(),
            impact: impactM?.[1]?.trim() || '',
            evidence: evidenceM?.[1]?.trim() || '',
            recommendation: recM?.[1]?.trim() || '',
          });
        }
      }
    }
  }

  // Parse focus areas
  const focusAreas: SynthesisReport['focusAreas'] = [];
  if (focusMatch) {
    const focusLines = focusMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of focusLines) {
      const timeM = line.match(/TIMEFRAME:\s*(30d|60d|90d)/i);
      const focusM = line.match(/FOCUS:\s*([^|]+)/i);
      const whyM = line.match(/WHY:\s*([^|]+)/i);
      const metricM = line.match(/METRIC:\s*(.+)/i);
      if (timeM && focusM) {
        focusAreas.push({
          timeframe: timeM[1],
          focus: focusM[1].trim(),
          why: whyM?.[1]?.trim() || '',
          metric: metricM?.[1]?.trim() || '',
        });
      }
    }
  }

  return {
    executiveSummary,
    categoryBreakdown,
    repPerformance,
    qualityPatterns,
    trainingRecommendations,
    sopRecommendations,
    policyGaps,
    focusAreas,
    stats: {
      totalTickets: stats.totalTickets,
      gradeDistribution: stats.gradeDistribution,
      avgScore: stats.avgScore,
      sentimentDistribution: stats.sentimentDistribution,
      resolutionDistribution: stats.resolutionDistribution,
      avgDimensions: stats.avgDimensions,
    },
    analyzedAt: new Date().toISOString(),
  };
}

// --- Exported synthesis runner (used by both API route and CLI script) ---

export async function runSynthesis(
  readerClient?: SupabaseClient,
  options?: { mode?: 'open' | 'closed' | 'all'; closedDays?: number }
): Promise<SynthesisReport> {
  const supabase = readerClient || (await createServerSupabaseClient());
  const mode = options?.mode || 'all';

  let query = supabase
    .from('ticket_quality_analyses')
    .select('*')
    .order('analyzed_at', { ascending: false });

  if (mode === 'open') {
    query = query.eq('is_closed', false);
  } else if (mode === 'closed') {
    query = query.eq('is_closed', true);
  }

  if (options?.closedDays) {
    const since = new Date();
    since.setDate(since.getDate() - options.closedDays);
    query = query.gte('ticket_created_at', since.toISOString());
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch quality analyses: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    throw new Error('No quality analyses found. Run Stage 1 analysis first.');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(rows as QualityRow[]);

  const { text } = await generateText({
    model: getOpusModel(),
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseSynthesisResponse(text, rows as QualityRow[]);
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
  if (authResult instanceof NextResponse) return authResult;

  try {
    let body: { mode?: string; closedDays?: number } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine — use defaults
    }

    const mode = (body.mode || 'all') as 'open' | 'closed' | 'all';
    const closedDays = body.closedDays;

    const report = await runSynthesis(undefined, { mode, closedDays });
    return NextResponse.json(report);
  } catch (error) {
    console.error('Support quality synthesis error:', error);
    return NextResponse.json(
      {
        error: 'Failed to synthesize quality report',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
