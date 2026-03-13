import { createServerSupabaseClient } from '@/lib/supabase/client';
import { generateText } from 'ai';
import { getOpusModel } from '@/lib/ai/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

interface RcmAnalysisRow {
  hubspot_ticket_id: string;
  is_rcm_related: boolean;
  rcm_system: string | null;
  issue_category: string | null;
  issue_summary: string | null;
  problems: string[] | null;
  severity: string | null;
  current_status: string | null;
  vendor_blamed: boolean | null;
  confidence: number;
  ticket_subject: string | null;
  company_name: string | null;
  assigned_rep: string | null;
  is_closed: boolean;
}

export interface RcmAuditReport {
  executiveSummary: string;
  ticketSummaries: {
    ticketId: string;
    subject: string | null;
    company: string | null;
    rep: string | null;
    rcmSystem: string | null;
    category: string | null;
    severity: string | null;
    status: string | null;
    summary: string | null;
    problems: string[];
    vendorBlamed: boolean;
  }[];
  systemBreakdown: {
    system: string;
    count: number;
    pct: string;
    categories: { name: string; count: number }[];
  }[];
  patterns: string[];
  urgentItems: {
    ticketId: string;
    subject: string | null;
    company: string | null;
    severity: string;
    summary: string | null;
  }[];
  stats: {
    totalAnalyzed: number;
    rcmRelated: number;
    rcmPct: string;
    bySeverity: { name: string; count: number; pct: string }[];
    byCategory: { name: string; count: number; pct: string }[];
    byStatus: { name: string; count: number; pct: string }[];
    vendorBlamedCount: number;
    vendorBlamedPct: string;
  };
  analyzedAt: string;
}

// --- Helpers ---

function distribution(items: string[]): { name: string; count: number; pct: string }[] {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] || 0) + 1;
  const total = items.length || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: `${((count / total) * 100).toFixed(1)}%` }));
}

function compressRcmRow(row: RcmAnalysisRow): string {
  const lines = [
    `[${row.hubspot_ticket_id}] ${row.ticket_subject || 'No subject'} | ${row.company_name || 'Unknown'} | Rep: ${row.assigned_rep || 'Unassigned'}`,
    `  System:${row.rcm_system || 'N/A'} | Category:${row.issue_category || 'N/A'} | Severity:${row.severity || 'N/A'} | Status:${row.current_status || 'N/A'} | Vendor:${row.vendor_blamed ? 'yes' : 'no'} | Closed:${row.is_closed}`,
  ];
  if (row.issue_summary) lines.push(`  Summary: ${row.issue_summary}`);
  if (row.problems && row.problems.length > 0) lines.push(`  Problems: ${row.problems.join('; ')}`);
  return lines.join('\n');
}

// --- Prompts ---

function buildSystemPrompt(): string {
  return `You are a senior RCM (Revenue Cycle Management) operations strategist for Opus Behavioral Health, a healthcare SaaS company.

You have received RCM ticket audit results. Each ticket has been classified by RCM system (Practice Suite vs Opus RCM), issue category, severity, and current status.

Your job is to synthesize these into an actionable RCM audit report for leadership.

Respond in the following structured format using exact section headers and delimiters.

===EXECUTIVE_SUMMARY===
3-5 sentences: overall RCM ticket landscape, Practice Suite vs Opus RCM split, most critical issues, vendor dependency assessment.

===PATTERNS===
One pattern per line. Identify recurring themes, systemic issues, and correlations. Be specific — cite ticket IDs.
PATTERN: description

===URGENT_ITEMS===
Top 5-10 most urgent items that need immediate attention, one per line:
TICKET: ID | SUBJECT: text | COMPANY: name | SEVERITY: level | REASON: why this is urgent

Guidelines:
- Be SPECIFIC — cite actual ticket IDs, company names, and systems
- Prioritize by revenue impact (claims blocked > delays > cosmetic)
- Call out vendor dependencies clearly
- Identify Practice Suite vs Opus RCM patterns separately
- Focus on what leadership can ACT on`;
}

function buildUserPrompt(rows: RcmAnalysisRow[]): string {
  const rcmRows = rows.filter((r) => r.is_rcm_related);
  const lines: string[] = [];

  lines.push(`Analyze the following ${rcmRows.length} RCM-related tickets (out of ${rows.length} total analyzed) and produce an actionable audit report.\n`);

  // System breakdown
  const systemCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  let vendorCount = 0;

  for (const row of rcmRows) {
    const sys = row.rcm_system || 'unknown';
    systemCounts[sys] = (systemCounts[sys] || 0) + 1;
    const cat = row.issue_category || 'other';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    const sev = row.severity || 'medium';
    severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    const status = row.current_status || 'active';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (row.vendor_blamed) vendorCount++;
  }

  lines.push('=== SUMMARY STATISTICS ===');
  lines.push(`Total Analyzed: ${rows.length}`);
  lines.push(`RCM-Related: ${rcmRows.length} (${((rcmRows.length / (rows.length || 1)) * 100).toFixed(1)}%)`);
  lines.push(`By System: ${Object.entries(systemCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`By Category: ${Object.entries(categoryCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`By Severity: ${Object.entries(severityCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`By Status: ${Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`Vendor-Blamed: ${vendorCount}/${rcmRows.length}`);
  lines.push('');

  // Critical/high severity first
  const urgent = rcmRows.filter((r) => r.severity === 'critical' || r.severity === 'high');
  if (urgent.length > 0) {
    lines.push('=== CRITICAL/HIGH SEVERITY TICKETS ===');
    for (const row of urgent) {
      lines.push(compressRcmRow(row));
    }
    lines.push('');
  }

  // All RCM tickets
  lines.push('=== ALL RCM TICKET ANALYSES ===');
  for (const row of rcmRows) {
    lines.push(compressRcmRow(row));
  }

  return lines.join('\n');
}

// --- Response Parsing ---

function parseSynthesisResponse(text: string, allRows: RcmAnalysisRow[]): RcmAuditReport {
  const rcmRows = allRows.filter((r) => r.is_rcm_related);
  const total = allRows.length || 1;

  // Stats
  const bySeverity = distribution(rcmRows.map((r) => r.severity || 'medium'));
  const byCategory = distribution(rcmRows.map((r) => r.issue_category || 'other'));
  const byStatus = distribution(rcmRows.map((r) => r.current_status || 'active'));
  const vendorBlamedCount = rcmRows.filter((r) => r.vendor_blamed).length;

  // System breakdown
  const systemMap: Record<string, { count: number; categories: Record<string, number> }> = {};
  for (const row of rcmRows) {
    const sys = row.rcm_system || 'unknown';
    if (!systemMap[sys]) systemMap[sys] = { count: 0, categories: {} };
    systemMap[sys].count++;
    const cat = row.issue_category || 'other';
    systemMap[sys].categories[cat] = (systemMap[sys].categories[cat] || 0) + 1;
  }
  const systemBreakdown = Object.entries(systemMap)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([system, data]) => ({
      system,
      count: data.count,
      pct: `${((data.count / (rcmRows.length || 1)) * 100).toFixed(1)}%`,
      categories: Object.entries(data.categories)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    }));

  // Ticket summaries
  const ticketSummaries = rcmRows.map((row) => ({
    ticketId: row.hubspot_ticket_id,
    subject: row.ticket_subject,
    company: row.company_name,
    rep: row.assigned_rep,
    rcmSystem: row.rcm_system,
    category: row.issue_category,
    severity: row.severity,
    status: row.current_status,
    summary: row.issue_summary,
    problems: row.problems || [],
    vendorBlamed: row.vendor_blamed || false,
  }));

  // Parse LLM sections
  const summaryMatch = text.match(/===EXECUTIVE_SUMMARY===([\s\S]*?)(?====|$)/);
  const executiveSummary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Parse patterns
  const patternsMatch = text.match(/===PATTERNS===([\s\S]*?)(?====|$)/);
  const patterns: string[] = [];
  if (patternsMatch) {
    const patternLines = patternsMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of patternLines) {
      const m = line.match(/PATTERN:\s*(.+)/i);
      if (m) patterns.push(m[1].trim());
    }
  }

  // Parse urgent items
  const urgentMatch = text.match(/===URGENT_ITEMS===([\s\S]*?)(?====|$)/);
  const urgentItems: RcmAuditReport['urgentItems'] = [];
  if (urgentMatch) {
    const urgentLines = urgentMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of urgentLines) {
      const ticketM = line.match(/TICKET:\s*([^|]+)/i);
      const subjectM = line.match(/SUBJECT:\s*([^|]+)/i);
      const companyM = line.match(/COMPANY:\s*([^|]+)/i);
      const sevM = line.match(/SEVERITY:\s*([^|]+)/i);
      const reasonM = line.match(/REASON:\s*(.+)/i);
      if (ticketM) {
        urgentItems.push({
          ticketId: ticketM[1].trim(),
          subject: subjectM?.[1]?.trim() || null,
          company: companyM?.[1]?.trim() || null,
          severity: sevM?.[1]?.trim() || 'high',
          summary: reasonM?.[1]?.trim() || null,
        });
      }
    }
  }

  return {
    executiveSummary,
    ticketSummaries,
    systemBreakdown,
    patterns,
    urgentItems,
    stats: {
      totalAnalyzed: allRows.length,
      rcmRelated: rcmRows.length,
      rcmPct: `${((rcmRows.length / total) * 100).toFixed(1)}%`,
      bySeverity,
      byCategory,
      byStatus,
      vendorBlamedCount,
      vendorBlamedPct: `${((vendorBlamedCount / (rcmRows.length || 1)) * 100).toFixed(1)}%`,
    },
    analyzedAt: new Date().toISOString(),
  };
}

// --- Exported synthesis runner ---

export async function runRcmSynthesis(
  readerClient?: SupabaseClient,
  options?: { mode?: 'open' | 'all' }
): Promise<RcmAuditReport> {
  const supabase = readerClient || (await createServerSupabaseClient());
  const mode = options?.mode || 'all';

  let query = supabase
    .from('ticket_rcm_analyses')
    .select('*')
    .order('analyzed_at', { ascending: false });

  if (mode === 'open') {
    query = query.eq('is_closed', false);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch RCM analyses: ${error.message}`);
  }

  if (!rows || rows.length === 0) {
    throw new Error('No RCM analyses found. Run Stage 1 analysis first.');
  }

  const rcmRows = (rows as RcmAnalysisRow[]).filter((r) => r.is_rcm_related);
  if (rcmRows.length === 0) {
    throw new Error('No RCM-related tickets found in analyses. All tickets were classified as non-RCM.');
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(rows as RcmAnalysisRow[]);

  const { text } = await generateText({
    model: getOpusModel(),
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseSynthesisResponse(text, rows as RcmAnalysisRow[]);
}
