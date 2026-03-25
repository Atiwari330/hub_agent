import { generateText } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import type { TicketContext, AllPassResults, QualityReviewResult, QualityIssue } from './types';

export async function runQualityReviewPass(
  context: TicketContext,
  passResults: AllPassResults
): Promise<QualityReviewResult> {
  const model = getModelForPass('quality_review');

  const systemPrompt = `You are a quality reviewer for support ticket analyses. You are reviewing analysis that will be shown to support agents on an operational action board.

Your job is to evaluate the analysis quality and identify specific issues. You are reviewing the combined output of multiple specialized analysis passes.

REVIEW CRITERIA:

1. SPECIFICITY (0.00-1.00):
   - Every action item must be executable by someone with zero context
   - "Follow up" is NEVER acceptable — what exactly should they follow up about?
   - Include ticket numbers, names, dates, and specific details from the conversation
   - Score 0.0 if any action item is vague; 1.0 if every item is crystal clear

2. ACCURACY (0.00-1.00):
   - Does the situation summary accurately reflect the conversation?
   - Are there any factual errors (wrong names, dates, claims)?
   - Score 0.0 for material inaccuracies; 1.0 for complete accuracy

3. COMPLETENESS (0.00-1.00):
   - Count the pending actions visible in the conversation
   - Compare to the action items generated
   - Any missed action = score reduction
   - Score 0.0 if major actions missing; 1.0 if all captured

4. TEMPERATURE_CALIBRATION (0.00-1.00):
   - Read the customer's actual words in the conversation
   - Is the temperature rating justified by evidence?
   - Over-rating (calm→angry) and under-rating (angry→calm) both score 0.0

5. PRIORITY_CORRECTNESS (0.00-1.00):
   - Co-Destiny (VIP) tickets with waiting customers: all actions should be "now"
   - Customer waiting 4+ hours: at least one action should be "now"
   - Routine status updates: "this_week" is appropriate
   - Score 0.0 for egregiously wrong priorities

6. ACTIONABILITY (0.00-1.00):
   - Can an agent read the action item and immediately know what to do?
   - Are there ambiguous references ("check the issue", "update the team")?
   - Score 0.0 if agent would need to investigate before acting

For each issue found, output a JSON object with these fields:
- dimension: which of the 6 dimensions
- severity: "critical" (blocks agent work), "warning" (reduces quality), or "suggestion" (nice to have)
- description: what's wrong
- affected_field: e.g., "action_items[0].description", "customer_temperature", "situation_summary"
- suggested_fix: specific improvement

Output your review in EXACTLY this format:

OVERALL_SCORE: <number 0.00-1.00>
DIMENSION_SCORES: <JSON object with keys: specificity, accuracy, completeness, temperature_calibration, priority_correctness, actionability — each 0.00-1.00>
ISSUES: <JSON array of issue objects, or empty array [] if none>
PASS_APPROVED: <true or false — true if OVERALL_SCORE >= 0.70>`;

  const analysisSection = buildAnalysisSection(passResults);
  const userPrompt = `${buildTicketMetadataSection(context)}

CONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}

ENGAGEMENT TIMELINE (${context.engagementTimeline.engagements.length} items):
${context.engagementTimelineText}${context.linearContext ? `\n\n${buildLinearSection(context)}` : ''}

---

ANALYSIS OUTPUT TO REVIEW:

${analysisSection}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseQualityReviewResult(result.text || '');
}

function buildAnalysisSection(results: AllPassResults): string {
  const parts: string[] = [];

  if (results.situation) {
    parts.push(`SITUATION SUMMARY:\n${results.situation.situation_summary}`);
    if (results.situation.context_snapshot) {
      parts.push(`CONTEXT SNAPSHOT:\n${results.situation.context_snapshot}`);
    }
  }

  if (results.actionItems) {
    const itemsText = results.actionItems.action_items
      .map((item, i) => `  [${i}] (${item.priority}) [${item.who}] ${item.description}`)
      .join('\n');
    parts.push(`ACTION ITEMS:\n${itemsText}`);
    parts.push(`STATUS TAGS: ${results.actionItems.status_tags.join(', ')}`);
  }

  if (results.temperature) {
    parts.push(`CUSTOMER TEMPERATURE: ${results.temperature.customer_temperature}`);
    parts.push(`TEMPERATURE REASON: ${results.temperature.temperature_reason}`);
  }

  if (results.timing) {
    parts.push(`TIMING:
  Hours since customer waiting: ${results.timing.hours_since_customer_waiting}
  Hours since last outbound: ${results.timing.hours_since_last_outbound ?? 'N/A'}
  Hours since last activity: ${results.timing.hours_since_last_activity ?? 'N/A'}`);
  }

  if (results.responseDraft) {
    parts.push(`RESPONSE GUIDANCE:\n${results.responseDraft.response_guidance}`);
    parts.push(`RESPONSE DRAFT:\n${results.responseDraft.response_draft}`);
  }

  if (results.crossTicket) {
    parts.push(`CROSS-TICKET NOTES:\n${results.crossTicket.related_ticket_notes}`);
  }

  return parts.join('\n\n');
}

function parseQualityReviewResult(text: string): QualityReviewResult {
  // Parse overall score
  const scoreMatch = text.match(/OVERALL_SCORE:\s*([\d.]+)/i);
  const overall_score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.5;

  // Parse dimension scores
  const dimMatch = text.match(/DIMENSION_SCORES:\s*(\{[^}]+\})/is);
  let dimension_scores = {
    specificity: 0.5,
    accuracy: 0.5,
    completeness: 0.5,
    temperature_calibration: 0.5,
    priority_correctness: 0.5,
    actionability: 0.5,
  };
  if (dimMatch) {
    try {
      const parsed = JSON.parse(dimMatch[1]);
      dimension_scores = {
        specificity: clampScore(parsed.specificity),
        accuracy: clampScore(parsed.accuracy),
        completeness: clampScore(parsed.completeness),
        temperature_calibration: clampScore(parsed.temperature_calibration),
        priority_correctness: clampScore(parsed.priority_correctness),
        actionability: clampScore(parsed.actionability),
      };
    } catch {
      console.warn('Failed to parse dimension scores, using defaults');
    }
  }

  // Parse issues
  const issuesMatch = text.match(/ISSUES:\s*(\[[\s\S]*?\])(?=\s*PASS_APPROVED:|\s*$)/i);
  let issues: QualityIssue[] = [];
  if (issuesMatch) {
    try {
      const parsed = JSON.parse(issuesMatch[1]);
      if (Array.isArray(parsed)) {
        issues = parsed.map((issue: Record<string, string>) => ({
          dimension: issue.dimension || 'unknown',
          severity: (['critical', 'warning', 'suggestion'].includes(issue.severity)
            ? issue.severity
            : 'warning') as QualityIssue['severity'],
          description: issue.description || '',
          affected_field: issue.affected_field || '',
          suggested_fix: issue.suggested_fix || '',
        }));
      }
    } catch {
      console.warn('Failed to parse quality issues, using empty array');
    }
  }

  // Parse pass_approved
  const approvedMatch = text.match(/PASS_APPROVED:\s*(true|false)/i);
  const threshold = parseFloat(process.env.QUALITY_REVIEW_THRESHOLD || '0.70');
  const pass_approved = approvedMatch
    ? approvedMatch[1].toLowerCase() === 'true'
    : overall_score >= threshold;

  return {
    overall_score: clampScore(overall_score),
    dimension_scores,
    issues,
    pass_approved,
  };
}

function clampScore(value: unknown): number {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}
