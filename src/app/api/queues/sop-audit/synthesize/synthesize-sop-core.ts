import { createServerSupabaseClient } from '@/lib/supabase/client';
import { generateText } from 'ai';
import { getOpusModel } from '@/lib/ai/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

interface SopAnalysisRow {
  hubspot_ticket_id: string;
  sop_product_area: string;
  sop_issue_type: string;
  sop_severity: string;
  sop_recommended_routing: string;
  sop_authorization_required: string;
  classification_confidence: number;
  classification_reasoning: string;
  triage_compliance_score: number;
  routing_compliance_score: number;
  authorization_compliance_score: number;
  communication_compliance_score: number;
  documentation_compliance_score: number;
  vendor_compliance_score: number | null;
  compliance_score: number;
  compliance_grade: string;
  clean_fit: boolean;
  ambiguity_flags: string | null;
  sop_gap_identified: boolean;
  sop_gap_description: string | null;
  sop_gap_severity: string | null;
  edge_case_notes: string | null;
  key_evidence: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  is_closed: boolean;
  assigned_rep: string | null;
}

export interface SopAuditReport {
  executiveSummary: string;
  classificationDistribution: {
    productArea: { name: string; count: number; pct: string }[];
    issueType: { name: string; count: number; pct: string }[];
    severity: { name: string; count: number; pct: string }[];
    routing: { name: string; count: number; pct: string }[];
  };
  confidenceAnalysis: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    hardToClassify: { ticketId: string; subject: string | null; confidence: number; reasoning: string }[];
  };
  sopCoverage: {
    cleanFitPct: string;
    cleanFitCount: number;
    totalTickets: number;
    gaps: { description: string; severity: string; ticketIds: string[] }[];
    ambiguities: { description: string; ticketIds: string[] }[];
  };
  complianceScorecard: {
    overallAvg: number;
    overallGrade: string;
    byDimension: { dimension: string; avg: number }[];
    byRep: { rep: string; tickets: number; avgScore: number; grade: string; strengths: string; weaknesses: string }[];
    worstViolations: { ticketId: string; subject: string | null; rep: string | null; score: number; grade: string; issue: string }[];
  };
  sopRevisionRecommendations: {
    priority: string;
    sopDocument: string;
    section: string;
    recommendation: string;
    evidence: string;
  }[];
  stats: {
    totalTickets: number;
    avgComplianceScore: number;
    avgConfidence: number;
    gapRate: string;
    cleanFitRate: string;
    gradeDistribution: Record<string, number>;
  };
  analyzedAt: string;
}

// --- Helpers ---

function scoreToGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function distribution(items: string[]): { name: string; count: number; pct: string }[] {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] || 0) + 1;
  const total = items.length || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: `${((count / total) * 100).toFixed(1)}%` }));
}

function compressAnalysis(row: SopAnalysisRow): string {
  const lines = [
    `[${row.hubspot_ticket_id}] ${row.ticket_subject || 'No subject'} | ${row.company_name || 'Unknown'} | Rep: ${row.assigned_rep || 'Unassigned'}`,
    `  Product:${row.sop_product_area} | Type:${row.sop_issue_type} | Sev:${row.sop_severity} | Route:${row.sop_recommended_routing} | Auth:${row.sop_authorization_required}`,
    `  Compliance:${row.compliance_grade}(${row.compliance_score}) Confidence:${row.classification_confidence} | Triage:${row.triage_compliance_score} Route:${row.routing_compliance_score} Auth:${row.authorization_compliance_score} Comm:${row.communication_compliance_score} Doc:${row.documentation_compliance_score}${row.vendor_compliance_score !== null ? ` Vendor:${row.vendor_compliance_score}` : ''}`,
    `  CleanFit:${row.clean_fit} Gap:${row.sop_gap_identified}${row.sop_gap_description ? ` — ${row.sop_gap_description}` : ''}`,
  ];
  if (row.ambiguity_flags) lines.push(`  Ambiguity: ${row.ambiguity_flags}`);
  if (row.key_evidence) lines.push(`  Evidence: ${row.key_evidence.slice(0, 200)}`);
  return lines.join('\n');
}

function computeStats(rows: SopAnalysisRow[]) {
  const n = rows.length || 1;
  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let totalCompliance = 0;
  let totalConfidence = 0;
  let gapCount = 0;
  let cleanFitCount = 0;

  const repStats: Record<string, { tickets: number; totalScore: number }> = {};
  let totalTriage = 0, totalRouting = 0, totalAuth = 0, totalComm = 0, totalDoc = 0;
  let vendorCount = 0, totalVendor = 0;

  for (const row of rows) {
    gradeDistribution[row.compliance_grade] = (gradeDistribution[row.compliance_grade] || 0) + 1;
    totalCompliance += row.compliance_score;
    totalConfidence += row.classification_confidence;
    if (row.sop_gap_identified) gapCount++;
    if (row.clean_fit) cleanFitCount++;

    totalTriage += row.triage_compliance_score;
    totalRouting += row.routing_compliance_score;
    totalAuth += row.authorization_compliance_score;
    totalComm += row.communication_compliance_score;
    totalDoc += row.documentation_compliance_score;
    if (row.vendor_compliance_score !== null) {
      vendorCount++;
      totalVendor += row.vendor_compliance_score;
    }

    const rep = row.assigned_rep || 'Unassigned';
    if (!repStats[rep]) repStats[rep] = { tickets: 0, totalScore: 0 };
    repStats[rep].tickets++;
    repStats[rep].totalScore += row.compliance_score;
  }

  return {
    totalTickets: rows.length,
    avgComplianceScore: Math.round(totalCompliance / n),
    avgConfidence: parseFloat((totalConfidence / n).toFixed(2)),
    gapRate: `${((gapCount / n) * 100).toFixed(1)}%`,
    cleanFitRate: `${((cleanFitCount / n) * 100).toFixed(1)}%`,
    gradeDistribution,
    gapCount,
    cleanFitCount,
    avgDimensions: {
      triage: parseFloat((totalTriage / n).toFixed(1)),
      routing: parseFloat((totalRouting / n).toFixed(1)),
      authorization: parseFloat((totalAuth / n).toFixed(1)),
      communication: parseFloat((totalComm / n).toFixed(1)),
      documentation: parseFloat((totalDoc / n).toFixed(1)),
      vendor: vendorCount > 0 ? parseFloat((totalVendor / vendorCount).toFixed(1)) : null,
    },
    repStats,
  };
}

// --- Prompts ---

function buildSystemPrompt(): string {
  return `You are a senior support operations strategist for Opus Behavioral Health, a healthcare SaaS company.

You have received SOP compliance audit results for support tickets. Each ticket has been classified per the company's SOP framework and scored for compliance across 5-6 dimensions (triage, routing, authorization, communication, documentation, vendor coordination).

Your job is to synthesize these into a strategic SOP effectiveness report for the VP of Support and VP of RevOps.

Respond in the following structured format using exact section headers and delimiters.

===EXECUTIVE_SUMMARY===
3-5 sentences: overall SOP effectiveness, average compliance score, classification confidence, most significant finding.

===COMPLIANCE_SCORECARD===
Per-rep performance, one per line:
REP: name | TICKETS: N | AVG_SCORE: Y | GRADE: X | STRENGTHS: brief | WEAKNESSES: brief

Order by ticket volume descending.

===WORST_VIOLATIONS===
Top 5-10 worst compliance issues, one per line:
TICKET: ID | SUBJECT: text | REP: name | SCORE: N | GRADE: X | ISSUE: what went wrong

===SOP_REVISION_RECOMMENDATIONS===
Prioritized SOP changes, one per line:
PRIORITY: critical|high|medium | SOP_DOCUMENT: name | SECTION: which section | RECOMMENDATION: what to change | EVIDENCE: ticket IDs/examples

Include 3-8 recommendations ranked by impact.

Guidelines:
- Be SPECIFIC — cite actual ticket IDs, rep names, and metrics
- Back every recommendation with evidence
- Prioritize by business impact
- Focus on actionable items
- High-severity tickets with compliance issues deserve more weight`;
}

function buildUserPrompt(rows: SopAnalysisRow[]): string {
  const stats = computeStats(rows);
  const lines: string[] = [];

  lines.push(`Analyze the following ${rows.length} SOP compliance audit results and produce strategic recommendations.\n`);

  lines.push('=== SUMMARY STATISTICS ===');
  lines.push(`Total Tickets: ${stats.totalTickets}`);
  lines.push(`Average Compliance Score: ${stats.avgComplianceScore}/100`);
  lines.push(`Average Classification Confidence: ${stats.avgConfidence}`);
  lines.push(`Clean Fit Rate: ${stats.cleanFitRate} (${stats.cleanFitCount}/${stats.totalTickets})`);
  lines.push(`SOP Gap Rate: ${stats.gapRate} (${stats.gapCount}/${stats.totalTickets})`);
  lines.push(`Grade Distribution: A:${stats.gradeDistribution.A || 0} B:${stats.gradeDistribution.B || 0} C:${stats.gradeDistribution.C || 0} D:${stats.gradeDistribution.D || 0} F:${stats.gradeDistribution.F || 0}`);
  lines.push(`Avg Dimensions: Triage:${stats.avgDimensions.triage} Routing:${stats.avgDimensions.routing} Auth:${stats.avgDimensions.authorization} Comm:${stats.avgDimensions.communication} Doc:${stats.avgDimensions.documentation}${stats.avgDimensions.vendor !== null ? ` Vendor:${stats.avgDimensions.vendor}` : ''}`);
  lines.push('');

  // By rep
  lines.push('=== BY REP (pre-computed) ===');
  const repEntries = Object.entries(stats.repStats).sort((a, b) => b[1].tickets - a[1].tickets);
  for (const [rep, data] of repEntries) {
    const avg = Math.round(data.totalScore / data.tickets);
    lines.push(`${rep} | tickets:${data.tickets} | avg_score:${avg}`);
  }
  lines.push('');

  // Gaps inventory
  const gapRows = rows.filter((r) => r.sop_gap_identified && r.sop_gap_description);
  if (gapRows.length > 0) {
    lines.push('=== SOP GAPS IDENTIFIED ===');
    for (const r of gapRows) {
      lines.push(`[${r.hubspot_ticket_id}] ${r.sop_gap_description} (severity: ${r.sop_gap_severity || 'unknown'})`);
    }
    lines.push('');
  }

  // Individual analyses (compressed)
  lines.push('=== INDIVIDUAL TICKET ANALYSES ===');
  for (const row of rows) {
    lines.push(compressAnalysis(row));
  }

  return lines.join('\n');
}

// --- Response Parsing ---

function parseSynthesisResponse(text: string, rows: SopAnalysisRow[]): SopAuditReport {
  const stats = computeStats(rows);

  // Pre-compute distributions
  const productAreaDist = distribution(rows.map((r) => r.sop_product_area));
  const issueTypeDist = distribution(rows.map((r) => r.sop_issue_type));
  const severityDist = distribution(rows.map((r) => r.sop_severity));
  const routingDist = distribution(rows.map((r) => r.sop_recommended_routing));

  // Confidence analysis
  const highConf = rows.filter((r) => r.classification_confidence >= 0.8).length;
  const medConf = rows.filter((r) => r.classification_confidence >= 0.5 && r.classification_confidence < 0.8).length;
  const lowConf = rows.filter((r) => r.classification_confidence < 0.5).length;
  const hardToClassify = rows
    .filter((r) => r.classification_confidence < 0.6)
    .sort((a, b) => a.classification_confidence - b.classification_confidence)
    .slice(0, 10)
    .map((r) => ({
      ticketId: r.hubspot_ticket_id,
      subject: r.ticket_subject,
      confidence: r.classification_confidence,
      reasoning: r.classification_reasoning,
    }));

  // Coverage
  const gapRows = rows.filter((r) => r.sop_gap_identified && r.sop_gap_description);
  const gapMap = new Map<string, { severity: string; ticketIds: string[] }>();
  for (const r of gapRows) {
    const desc = r.sop_gap_description!;
    const existing = gapMap.get(desc);
    if (existing) {
      existing.ticketIds.push(r.hubspot_ticket_id);
    } else {
      gapMap.set(desc, { severity: r.sop_gap_severity || 'medium', ticketIds: [r.hubspot_ticket_id] });
    }
  }
  const gaps = Array.from(gapMap.entries()).map(([description, data]) => ({
    description,
    severity: data.severity,
    ticketIds: data.ticketIds,
  }));

  const ambiguityRows = rows.filter((r) => r.ambiguity_flags);
  const ambiguityMap = new Map<string, string[]>();
  for (const r of ambiguityRows) {
    const desc = r.ambiguity_flags!;
    const existing = ambiguityMap.get(desc);
    if (existing) {
      existing.push(r.hubspot_ticket_id);
    } else {
      ambiguityMap.set(desc, [r.hubspot_ticket_id]);
    }
  }
  const ambiguities = Array.from(ambiguityMap.entries()).map(([description, ticketIds]) => ({
    description,
    ticketIds,
  }));

  // Compliance by dimension
  const byDimension = [
    { dimension: 'Triage', avg: stats.avgDimensions.triage },
    { dimension: 'Routing', avg: stats.avgDimensions.routing },
    { dimension: 'Authorization', avg: stats.avgDimensions.authorization },
    { dimension: 'Communication', avg: stats.avgDimensions.communication },
    { dimension: 'Documentation', avg: stats.avgDimensions.documentation },
  ];
  if (stats.avgDimensions.vendor !== null) {
    byDimension.push({ dimension: 'Vendor Coordination', avg: stats.avgDimensions.vendor });
  }

  // Parse LLM sections
  const summaryMatch = text.match(/===EXECUTIVE_SUMMARY===([\s\S]*?)(?====|$)/);
  const executiveSummary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Parse rep performance from LLM
  const repMatch = text.match(/===COMPLIANCE_SCORECARD===([\s\S]*?)(?====|$)/);
  const byRep: SopAuditReport['complianceScorecard']['byRep'] = [];
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
        byRep.push({
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

  // Parse worst violations
  const violMatch = text.match(/===WORST_VIOLATIONS===([\s\S]*?)(?====|$)/);
  const worstViolations: SopAuditReport['complianceScorecard']['worstViolations'] = [];
  if (violMatch) {
    const violLines = violMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of violLines) {
      const ticketM = line.match(/TICKET:\s*([^|]+)/i);
      const subjectM = line.match(/SUBJECT:\s*([^|]+)/i);
      const repM = line.match(/REP:\s*([^|]+)/i);
      const scoreM = line.match(/SCORE:\s*([\d.]+)/i);
      const gradeM = line.match(/GRADE:\s*([ABCDF])/i);
      const issueM = line.match(/ISSUE:\s*(.+)/i);
      if (ticketM) {
        worstViolations.push({
          ticketId: ticketM[1].trim(),
          subject: subjectM?.[1]?.trim() || null,
          rep: repM?.[1]?.trim() || null,
          score: scoreM ? parseFloat(scoreM[1]) : 0,
          grade: gradeM?.[1] || 'F',
          issue: issueM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse SOP revision recommendations
  const revMatch = text.match(/===SOP_REVISION_RECOMMENDATIONS===([\s\S]*?)(?====|$)/);
  const sopRevisionRecommendations: SopAuditReport['sopRevisionRecommendations'] = [];
  if (revMatch) {
    const revLines = revMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of revLines) {
      const priM = line.match(/PRIORITY:\s*(critical|high|medium)/i);
      const docM = line.match(/SOP_DOCUMENT:\s*([^|]+)/i);
      const secM = line.match(/SECTION:\s*([^|]+)/i);
      const recM = line.match(/RECOMMENDATION:\s*([^|]+)/i);
      const evidenceM = line.match(/EVIDENCE:\s*(.+)/i);
      if (priM && docM) {
        sopRevisionRecommendations.push({
          priority: priM[1].toLowerCase(),
          sopDocument: docM[1].trim(),
          section: secM?.[1]?.trim() || '',
          recommendation: recM?.[1]?.trim() || '',
          evidence: evidenceM?.[1]?.trim() || '',
        });
      }
    }
  }

  return {
    executiveSummary,
    classificationDistribution: {
      productArea: productAreaDist,
      issueType: issueTypeDist,
      severity: severityDist,
      routing: routingDist,
    },
    confidenceAnalysis: {
      highConfidence: highConf,
      mediumConfidence: medConf,
      lowConfidence: lowConf,
      hardToClassify,
    },
    sopCoverage: {
      cleanFitPct: stats.cleanFitRate,
      cleanFitCount: stats.cleanFitCount,
      totalTickets: stats.totalTickets,
      gaps,
      ambiguities,
    },
    complianceScorecard: {
      overallAvg: stats.avgComplianceScore,
      overallGrade: scoreToGrade(stats.avgComplianceScore),
      byDimension,
      byRep,
      worstViolations,
    },
    sopRevisionRecommendations,
    stats: {
      totalTickets: stats.totalTickets,
      avgComplianceScore: stats.avgComplianceScore,
      avgConfidence: stats.avgConfidence,
      gapRate: stats.gapRate,
      cleanFitRate: stats.cleanFitRate,
      gradeDistribution: stats.gradeDistribution,
    },
    analyzedAt: new Date().toISOString(),
  };
}

// --- Exported synthesis runner ---

export async function runSopSynthesis(
  readerClient?: SupabaseClient,
  options?: { mode?: 'open' | 'all' }
): Promise<SopAuditReport> {
  const supabase = readerClient || (await createServerSupabaseClient());
  const mode = options?.mode || 'all';

  let query = supabase
    .from('ticket_sop_analyses')
    .select('*')
    .order('analyzed_at', { ascending: false });

  if (mode === 'open') {
    query = query.eq('is_closed', false);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch SOP analyses: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    throw new Error('No SOP analyses found. Run Stage 1 analysis first.');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(rows as SopAnalysisRow[]);

  const { text } = await generateText({
    model: getOpusModel(),
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseSynthesisResponse(text, rows as SopAnalysisRow[]);
}
