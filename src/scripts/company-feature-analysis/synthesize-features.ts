/**
 * Stage 2: Aggregate feature synthesis (Opus)
 *
 * Takes per-ticket feature analyses and produces a unified
 * CompanyFeatureReport with deduplicated feature requests,
 * ranked pain points, and strategic recommendations.
 */

import { generateText } from 'ai';
import { getOpusModel } from '../../lib/ai/provider';
import type { TicketFeatureAnalysis } from './analyze-features';

// --- Types ---

export interface RankedFeatureRequest {
  description: string;
  ticketCount: number;
  ticketIds: string[];
  productArea: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  type: 'explicit' | 'inferred' | 'mixed';
  evidence: string;
}

export interface RankedPainPoint {
  description: string;
  ticketCount: number;
  ticketIds: string[];
  productArea: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string;
}

export interface ProductAreaTheme {
  productArea: string;
  themes: string[];
  ticketCount: number;
  overallSeverity: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
}

export interface CustomerHealthSignals {
  overallFrustration: 'very_high' | 'high' | 'moderate' | 'low';
  relationship: string;
}

export interface CompanyFeatureReport {
  companyName: string;
  companyId: string;
  executiveSummary: string;
  featureRequests: RankedFeatureRequest[];
  painPoints: RankedPainPoint[];
  productAreaThemes: ProductAreaTheme[];
  customerHealth: CustomerHealthSignals;
  stats: {
    totalTickets: number;
    ticketsWithFeatureRequests: number;
    ticketsWithPainPoints: number;
    totalFeatureRequests: number;
    totalPainPoints: number;
    frustrationDistribution: Record<string, number>;
    productAreaDistribution: Record<string, number>;
  };
  analyzedAt: string;
}

// --- Compress per-ticket analysis for the prompt ---

function compressAnalysis(a: TicketFeatureAnalysis): string {
  const lines: string[] = [];
  lines.push(`[${a.ticketId}] ${a.subject || 'No subject'} | Frustration: ${a.frustrationLevel} | Conf: ${a.confidence}`);

  if (a.featureRequests.length > 0) {
    for (const fr of a.featureRequests) {
      lines.push(`  FR(${fr.type}): [${fr.productArea}] [${fr.urgency}] ${fr.description}`);
    }
  }

  if (a.painPoints.length > 0) {
    for (const pp of a.painPoints) {
      lines.push(`  PP: [${pp.productArea}] [${pp.severity}] ${pp.description} (freq: ${pp.frequencyHint})`);
    }
  }

  if (a.recurringThemes.length > 0) {
    lines.push(`  Themes: ${a.recurringThemes.join(', ')}`);
  }

  lines.push(`  Summary: ${a.summary}`);
  return lines.join('\n');
}

// --- Pre-compute statistics ---

function computeStats(analyses: TicketFeatureAnalysis[]) {
  const frustrationDistribution: Record<string, number> = {};
  const productAreaDistribution: Record<string, number> = {};
  let ticketsWithFR = 0;
  let ticketsWithPP = 0;
  let totalFR = 0;
  let totalPP = 0;

  for (const a of analyses) {
    // Frustration
    frustrationDistribution[a.frustrationLevel] = (frustrationDistribution[a.frustrationLevel] || 0) + 1;

    // Product areas
    for (const area of a.productAreas) {
      productAreaDistribution[area] = (productAreaDistribution[area] || 0) + 1;
    }

    // Feature requests
    if (a.featureRequests.length > 0) {
      ticketsWithFR++;
      totalFR += a.featureRequests.length;
    }

    // Pain points
    if (a.painPoints.length > 0) {
      ticketsWithPP++;
      totalPP += a.painPoints.length;
    }
  }

  return {
    totalTickets: analyses.length,
    ticketsWithFeatureRequests: ticketsWithFR,
    ticketsWithPainPoints: ticketsWithPP,
    totalFeatureRequests: totalFR,
    totalPainPoints: totalPP,
    frustrationDistribution,
    productAreaDistribution,
  };
}

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are a senior product intelligence analyst for Opus Behavioral Health, a healthcare SaaS company that sells EHR (Electronic Health Records), RCM (Revenue Cycle Management), and Copilot AI products to behavioral health providers.

You have received per-ticket feature analyses from a specific customer's support history. Each analysis contains extracted feature requests, pain points, product areas, frustration levels, and summaries.

Your job is to synthesize these into a PRODUCT-FOCUSED intelligence report. Focus EXCLUSIVELY on system functionality — what the software should do that it doesn't, or what it should do better. This is for the product/engineering team to prioritize their roadmap.

IMPORTANT — SCOPE RULES:
- INCLUDE: Feature requests (explicit customer asks + inferred from pain patterns), system bugs, missing functionality, UX/performance issues, integration gaps, API improvements
- EXCLUDE: Support team process issues (SLA tracking, handoff procedures, training needs, staffing), internal operational recommendations, communication/response time issues. These are out of scope.
- When a ticket reveals both a process issue AND a system issue, extract ONLY the system issue.
- "The system should..." is in scope. "The team should..." is out of scope.

Respond in the following structured format. Use the exact section headers and delimiters shown below.

===EXECUTIVE_SUMMARY===
3-5 sentences summarizing what this customer needs from the product. Focus on: the biggest functionality gaps, the most impactful system improvements, and recurring patterns across tickets.

===FEATURE_REQUESTS===
Deduplicated and merged feature requests across all tickets, ranked by importance. These are things the customer wants the system to do. One per line:
DESC: description of the system capability needed | TICKET_COUNT: N | TICKET_IDS: id1,id2 | AREA: product_area | URGENCY: critical|high|medium|low | TYPE: explicit|inferred|mixed | EVIDENCE: what the customer said or experienced that reveals this need

"Explicit" = customer directly asked for it ("I wish...", "Can you add...", "We need...")
"Inferred" = customer didn't ask, but their repeated pain implies this feature would solve their problem

Merge similar requests across tickets. Rank by: urgency * ticket_count. Include up to 20 entries — be thorough.

===SYSTEM_PAIN_POINTS===
System functionality issues causing this customer pain. Bugs, missing features, broken workflows, performance problems. One per line:
DESC: what's broken or inadequate in the system | TICKET_COUNT: N | TICKET_IDS: id1,id2 | AREA: product_area | SEVERITY: critical|high|medium|low | EVIDENCE: brief evidence summary

Merge similar pain points. Rank by severity * ticket_count. Include up to 15 entries.

===PRODUCT_AREA_THEMES===
Group findings by product area. One per entry:
AREA: product_area | TICKETS: N | SEVERITY: critical|high|medium|low | THEMES: comma-separated themes | SUMMARY: 1-2 sentence summary of what this customer needs in this area

===CUSTOMER_HEALTH===
OVERALL_FRUSTRATION: very_high|high|moderate|low
RELATIONSHIP: 1-2 sentence assessment focused on product satisfaction — are they happy with the system?

Guidelines:
- Be SPECIFIC — cite actual ticket IDs as evidence
- Merge duplicates — if 5 tickets mention the same feature, it's ONE feature request with count 5
- Prioritize by business impact to the customer
- Consider BOTH explicit asks and inferred needs
- Look for patterns across tickets that reveal systemic product gaps
- Every item should answer: "What should the engineering team build or fix?"`;
}

// --- User Prompt ---

function buildUserPrompt(
  analyses: TicketFeatureAnalysis[],
  companyName: string
): string {
  const stats = computeStats(analyses);
  const lines: string[] = [];

  lines.push(`Synthesize the following ${analyses.length} ticket analyses for customer "${companyName}" into a product intelligence report.\n`);

  // Summary stats
  lines.push('=== SUMMARY STATISTICS ===');
  lines.push(`Total Tickets Analyzed: ${stats.totalTickets}`);
  lines.push(`Tickets with Feature Requests: ${stats.ticketsWithFeatureRequests} (${stats.totalFeatureRequests} total requests)`);
  lines.push(`Tickets with Pain Points: ${stats.ticketsWithPainPoints} (${stats.totalPainPoints} total pain points)`);

  const frustEntries = Object.entries(stats.frustrationDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`Frustration Distribution: ${frustEntries.join(' ')}`);

  const areaEntries = Object.entries(stats.productAreaDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`Product Area Distribution: ${areaEntries.join(' ')}`);
  lines.push('');

  // Individual analyses (compressed)
  lines.push('=== INDIVIDUAL TICKET ANALYSES ===');
  for (const a of analyses) {
    lines.push(compressAnalysis(a));
  }

  return lines.join('\n');
}

// --- Response Parsing ---

function parseSynthesisResponse(
  text: string,
  analyses: TicketFeatureAnalysis[],
  companyName: string,
  companyId: string
): CompanyFeatureReport {
  const stats = computeStats(analyses);

  // Extract sections
  const summaryMatch = text.match(/===EXECUTIVE_SUMMARY===([\s\S]*?)(?====|$)/);
  const frMatch = text.match(/===FEATURE_REQUESTS===([\s\S]*?)(?====|$)/);
  const ppMatch = text.match(/===SYSTEM_PAIN_POINTS===([\s\S]*?)(?====|$)/);
  const areaMatch = text.match(/===PRODUCT_AREA_THEMES===([\s\S]*?)(?====|$)/);
  const healthMatch = text.match(/===CUSTOMER_HEALTH===([\s\S]*?)(?====|$)/);

  const executiveSummary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Parse feature requests
  const featureRequests: RankedFeatureRequest[] = [];
  if (frMatch) {
    const frLines = frMatch[1].trim().split('\n').filter((l) => l.trim().startsWith('DESC:'));
    for (const line of frLines) {
      const descM = line.match(/DESC:\s*([^|]+)/i);
      const countM = line.match(/TICKET_COUNT:\s*(\d+)/i);
      const idsM = line.match(/TICKET_IDS:\s*([^|]+)/i);
      const areaM = line.match(/AREA:\s*([^|]+)/i);
      const urgM = line.match(/URGENCY:\s*(critical|high|medium|low)/i);
      const typeM = line.match(/TYPE:\s*(explicit|inferred|mixed)/i);
      const evidenceM = line.match(/EVIDENCE:\s*(.+)/i);
      if (descM) {
        featureRequests.push({
          description: descM[1].trim(),
          ticketCount: countM ? parseInt(countM[1]) : 1,
          ticketIds: idsM ? idsM[1].split(',').map((id) => id.trim()) : [],
          productArea: areaM?.[1]?.trim() || 'Other',
          urgency: (urgM?.[1]?.toLowerCase() as RankedFeatureRequest['urgency']) || 'medium',
          type: (typeM?.[1]?.toLowerCase() as RankedFeatureRequest['type']) || 'inferred',
          evidence: evidenceM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse pain points
  const painPoints: RankedPainPoint[] = [];
  if (ppMatch) {
    const ppLines = ppMatch[1].trim().split('\n').filter((l) => l.trim().startsWith('DESC:'));
    for (const line of ppLines) {
      const descM = line.match(/DESC:\s*([^|]+)/i);
      const countM = line.match(/TICKET_COUNT:\s*(\d+)/i);
      const idsM = line.match(/TICKET_IDS:\s*([^|]+)/i);
      const areaM = line.match(/AREA:\s*([^|]+)/i);
      const sevM = line.match(/SEVERITY:\s*(critical|high|medium|low)/i);
      const evidenceM = line.match(/EVIDENCE:\s*(.+)/i);
      if (descM) {
        painPoints.push({
          description: descM[1].trim(),
          ticketCount: countM ? parseInt(countM[1]) : 1,
          ticketIds: idsM ? idsM[1].split(',').map((id) => id.trim()) : [],
          productArea: areaM?.[1]?.trim() || 'Other',
          severity: (sevM?.[1]?.toLowerCase() as RankedPainPoint['severity']) || 'medium',
          evidence: evidenceM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse product area themes
  const productAreaThemes: ProductAreaTheme[] = [];
  if (areaMatch) {
    const areaLines = areaMatch[1].trim().split('\n').filter((l) => l.trim().startsWith('AREA:'));
    for (const line of areaLines) {
      const areM = line.match(/AREA:\s*([^|]+)/i);
      const ticketsM = line.match(/TICKETS:\s*(\d+)/i);
      const sevM = line.match(/SEVERITY:\s*(critical|high|medium|low)/i);
      const themesM = line.match(/THEMES:\s*([^|]+)/i);
      const summM = line.match(/SUMMARY:\s*(.+)/i);
      if (areM) {
        productAreaThemes.push({
          productArea: areM[1].trim(),
          ticketCount: ticketsM ? parseInt(ticketsM[1]) : 0,
          overallSeverity: (sevM?.[1]?.toLowerCase() as ProductAreaTheme['overallSeverity']) || 'medium',
          themes: themesM ? themesM[1].split(',').map((t) => t.trim()) : [],
          summary: summM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse customer health
  const frustM = healthMatch?.[1]?.match(/OVERALL_FRUSTRATION:\s*(very_high|high|moderate|low)/i);
  const relM = healthMatch?.[1]?.match(/RELATIONSHIP:\s*(.+)/i);

  const customerHealth: CustomerHealthSignals = {
    overallFrustration: (frustM?.[1]?.toLowerCase() as CustomerHealthSignals['overallFrustration']) || 'moderate',
    relationship: relM?.[1]?.trim() || 'Unable to assess from available data.',
  };

  return {
    companyName,
    companyId,
    executiveSummary,
    featureRequests,
    painPoints,
    productAreaThemes,
    customerHealth,
    stats,
    analyzedAt: new Date().toISOString(),
  };
}

// --- Main export ---

export async function synthesizeFeatureReport(
  analyses: TicketFeatureAnalysis[],
  companyName: string,
  companyId: string
): Promise<CompanyFeatureReport> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(analyses, companyName);

  const { text } = await generateText({
    model: getOpusModel(),
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseSynthesisResponse(text, analyses, companyName, companyId);
}
