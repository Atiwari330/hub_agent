import { createServiceClient } from '@/lib/supabase/client';
import { generateText } from 'ai';
import { getModelForPass } from '@/lib/ai/passes/models';
import { upsertAlert } from './alert-utils';

/**
 * Cross-Ticket Pattern Detector — Phase 6, Proactive Intelligence
 *
 * Identifies when multiple tickets share a common root cause.
 *
 * Step 1: Group open tickets by software, keywords, company
 * Step 2: Detect anomalies (no LLM): volume spikes, keyword clusters, company clusters
 * Step 3: LLM analysis of detected clusters
 * Step 4: Write to detected_patterns + create per-ticket alerts
 */

const MIN_CLUSTER_SIZE = 3;            // Minimum tickets to form a pattern
const CLUSTER_WINDOW_HOURS = 48;       // Look back 48 hours for clusters
const VOLUME_SPIKE_MULTIPLIER = 3;     // 3x normal rate = spike

export interface PatternResult {
  patternsDetected: number;
  patternsCreated: number;
  alertsCreated: number;
  errors: string[];
}

export async function runPatternDetection(): Promise<PatternResult> {
  const supabase = createServiceClient();

  const result: PatternResult = {
    patternsDetected: 0,
    patternsCreated: 0,
    alertsCreated: 0,
    errors: [],
  };

  // Fetch all open tickets with their analyses
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, software, hs_primary_company_name, hubspot_created_at, category')
    .eq('is_closed', false);

  if (error || !tickets || tickets.length === 0) {
    result.errors.push(error?.message || 'No open tickets');
    return result;
  }

  // Also fetch situation summaries for richer context
  const ticketIds = tickets.map(t => t.hubspot_ticket_id);
  const { data: analyses } = await supabase
    .from('ticket_action_board_analyses')
    .select('hubspot_ticket_id, situation_summary')
    .in('hubspot_ticket_id', ticketIds);

  const analysisMap = new Map(
    (analyses || []).map(a => [a.hubspot_ticket_id, a.situation_summary])
  );

  // --- Detect clusters ---
  const clusters: DetectedCluster[] = [];

  // 1. Software clusters — tickets grouped by software module
  const softwareGroups = groupBy(tickets, t => t.software);
  for (const [software, group] of Object.entries(softwareGroups)) {
    if (!software || group.length < MIN_CLUSTER_SIZE) continue;
    clusters.push({
      type: 'common_issue',
      label: `${software} — ${group.length} open tickets`,
      tickets: group,
    });
  }

  // 2. Company clusters — multiple tickets from same company
  const companyGroups = groupBy(tickets, t => t.hs_primary_company_name);
  for (const [company, group] of Object.entries(companyGroups)) {
    if (!company || group.length < MIN_CLUSTER_SIZE) continue;
    clusters.push({
      type: 'company_cluster',
      label: `${company} — ${group.length} open tickets`,
      tickets: group,
    });
  }

  // 3. Volume spike — recent ticket creation rate
  const now = new Date();
  const windowStart = new Date(now.getTime() - CLUSTER_WINDOW_HOURS * 60 * 60 * 1000);
  const recentTickets = tickets.filter(t => {
    if (!t.hubspot_created_at) return false;
    return new Date(t.hubspot_created_at) > windowStart;
  });

  // Compare to expected rate (total open / 30 days * 2 days)
  const expectedInWindow = (tickets.length / 30) * (CLUSTER_WINDOW_HOURS / 24);
  if (recentTickets.length > expectedInWindow * VOLUME_SPIKE_MULTIPLIER && recentTickets.length >= MIN_CLUSTER_SIZE) {
    clusters.push({
      type: 'volume_spike',
      label: `Volume spike — ${recentTickets.length} tickets in last ${CLUSTER_WINDOW_HOURS}h (expected ~${Math.round(expectedInWindow)})`,
      tickets: recentTickets,
    });
  }

  // 4. Keyword clusters — common words in subjects
  const keywordClusters = findKeywordClusters(tickets);
  clusters.push(...keywordClusters);

  result.patternsDetected = clusters.length;

  if (clusters.length === 0) {
    return result;
  }

  // --- Check which patterns are already tracked ---
  const { data: existingPatterns } = await supabase
    .from('detected_patterns')
    .select('id, pattern_type, affected_ticket_ids, description')
    .eq('resolved', false);

  const existingSignatures = new Set(
    (existingPatterns || []).map(p => `${p.pattern_type}:${p.affected_ticket_ids.sort().join(',')}`)
  );

  // --- Analyze new clusters with LLM ---
  for (const cluster of clusters) {
    const ticketIds = cluster.tickets.map(t => t.hubspot_ticket_id);
    const signature = `${cluster.type}:${ticketIds.sort().join(',')}`;

    // Skip if we already have this exact pattern
    if (existingSignatures.has(signature)) continue;

    try {
      const analysis = await analyzeCuster(cluster, analysisMap);

      if (analysis.isPattern) {
        // Create pattern record
        const { error: insertError } = await supabase
          .from('detected_patterns')
          .insert({
            pattern_type: cluster.type,
            description: analysis.description,
            affected_ticket_ids: ticketIds,
            recommended_action: analysis.recommendedAction,
            confidence: analysis.confidence,
          });

        if (!insertError) {
          result.patternsCreated++;

          // Create per-ticket alerts
          for (const ticketId of ticketIds) {
            await upsertAlert({
              ticketId,
              alertType: 'pattern',
              severity: analysis.confidence >= 0.8 ? 'warning' : 'info',
              title: `Part of pattern: ${cluster.label}`,
              description: analysis.description,
              metadata: {
                pattern_type: cluster.type,
                affected_count: ticketIds.length,
                confidence: analysis.confidence,
              },
            });
            result.alertsCreated++;
          }
        }
      }
    } catch (err) {
      result.errors.push(`Cluster "${cluster.label}": ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return result;
}

// --- Helpers ---

interface DetectedCluster {
  type: 'common_issue' | 'volume_spike' | 'company_cluster';
  label: string;
  tickets: Array<{
    hubspot_ticket_id: string;
    subject: string | null;
    software: string | null;
    hs_primary_company_name: string | null;
    category?: string | null;
  }>;
}

interface ClusterAnalysis {
  isPattern: boolean;
  description: string;
  recommendedAction: string;
  confidence: number;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string | null): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function findKeywordClusters(tickets: Array<{ hubspot_ticket_id: string; subject: string | null; software: string | null; hs_primary_company_name: string | null }>): DetectedCluster[] {
  // Extract meaningful words from subjects
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'and', 'or', 'not', 'no', 'but', 'by', 'from', 'it', 'this', 'that', 'be',
    're', 'fw', 'fwd', 'ticket', 'issue', 'help', 'need', 'please', 'support', 'hi', 'hello']);

  const wordToTickets = new Map<string, typeof tickets>();

  for (const ticket of tickets) {
    if (!ticket.subject) continue;
    const words = ticket.subject.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Also check bigrams
    const uniqueWords = [...new Set(words)];
    for (const word of uniqueWords) {
      if (!wordToTickets.has(word)) wordToTickets.set(word, []);
      wordToTickets.get(word)!.push(ticket);
    }
  }

  const clusters: DetectedCluster[] = [];
  const usedTicketSets = new Set<string>();

  for (const [keyword, matchedTickets] of wordToTickets.entries()) {
    if (matchedTickets.length < MIN_CLUSTER_SIZE) continue;

    const key = matchedTickets.map(t => t.hubspot_ticket_id).sort().join(',');
    if (usedTicketSets.has(key)) continue;
    usedTicketSets.add(key);

    clusters.push({
      type: 'common_issue',
      label: `Keyword "${keyword}" — ${matchedTickets.length} tickets`,
      tickets: matchedTickets,
    });
  }

  return clusters;
}

async function analyzeCuster(
  cluster: DetectedCluster,
  analysisMap: Map<string, string>
): Promise<ClusterAnalysis> {
  // Use DeepSeek for pattern analysis
  const model = getModelForPass('cross_ticket');

  const ticketSummaries = cluster.tickets.map(t => {
    const summary = analysisMap.get(t.hubspot_ticket_id);
    return `- [${t.hubspot_ticket_id}] ${t.subject || 'No subject'} (${t.software || 'Unknown software'}, ${t.hs_primary_company_name || 'Unknown company'})${summary ? `\n  Summary: ${summary}` : ''}`;
  }).join('\n');

  const result = await generateText({
    model,
    system: `You are a support pattern analyst for a healthcare SaaS company (Opus Behavioral Health).

Analyze whether a group of support tickets represents a real pattern (likely shared root cause) or is a coincidence.

Output EXACTLY three fields:
IS_PATTERN: true or false
PATTERN_DESCRIPTION: One sentence describing the pattern if true, or why it's not a pattern if false
RECOMMENDED_ACTION: What the team should do (e.g., "Escalate to engineering as potential product bug", "Assign a dedicated agent to this company")
CONFIDENCE: A number 0.00 to 1.00`,
    prompt: `CLUSTER TYPE: ${cluster.type}
CLUSTER LABEL: ${cluster.label}
TICKET COUNT: ${cluster.tickets.length}

TICKETS:
${ticketSummaries}`,
  });

  const text = result.text || '';
  const isPattern = /IS_PATTERN:\s*true/i.test(text);
  const descMatch = text.match(/PATTERN_DESCRIPTION:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);
  const actionMatch = text.match(/RECOMMENDED_ACTION:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);
  const confMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

  return {
    isPattern,
    description: descMatch?.[1]?.trim() || cluster.label,
    recommendedAction: actionMatch?.[1]?.trim() || 'Review cluster for shared root cause',
    confidence: confMatch ? Math.min(parseFloat(confMatch[1]), 1.0) : 0.5,
  };
}
