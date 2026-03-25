import { generateText } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import type {
  TicketContext,
  AllPassResults,
  QualityIssue,
  RefinementResult,
} from './types';

export async function runRefinementPass(
  context: TicketContext,
  passResults: AllPassResults,
  issues: QualityIssue[]
): Promise<RefinementResult> {
  const model = getModelForPass('refinement');

  // Group issues by affected area to build targeted instructions
  const affectedAreas = new Set(issues.map(i => getAffectedArea(i.affected_field)));

  const systemPrompt = `You are a refinement agent for support ticket analyses. A quality reviewer has identified specific issues with the current analysis. Your job is to fix ONLY the flagged problems.

You will receive:
1. The original ticket context
2. The current analysis output
3. Specific issues identified by the reviewer

Fix each issue precisely. Do not change fields that were not flagged.

Output ONLY the corrected fields in this format (include only fields that need fixing):

${affectedAreas.has('situation_summary') ? 'SITUATION_SUMMARY: <corrected summary>' : ''}
${affectedAreas.has('action_items') ? `ACTION_ITEMS: <JSON array of corrected action items, each with: id (string), description (string), who (string), priority ("now"|"today"|"this_week"), status_tags (string array)>` : ''}
${affectedAreas.has('customer_temperature') ? 'CUSTOMER_TEMPERATURE: <corrected temperature: calm|frustrated|escalating|angry>\nTEMPERATURE_REASON: <corrected reason>' : ''}
${affectedAreas.has('response_draft') ? 'RESPONSE_GUIDANCE: <corrected guidance>\nRESPONSE_DRAFT: <corrected draft>' : ''}

If a field does not need fixing, do NOT include it in your output.`;

  const issuesList = issues
    .map((issue, i) => `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.dimension}: ${issue.description}\n   Affected: ${issue.affected_field}\n   Suggested fix: ${issue.suggested_fix}`)
    .join('\n\n');

  const currentAnalysis = buildCurrentAnalysisText(passResults);

  const userPrompt = `${buildTicketMetadataSection(context)}

CONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}

ENGAGEMENT TIMELINE (${context.engagementTimeline.engagements.length} items):
${context.engagementTimelineText}${context.linearContext ? `\n\n${buildLinearSection(context)}` : ''}

---

CURRENT ANALYSIS (contains issues):
${currentAnalysis}

---

ISSUES TO FIX:
${issuesList}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return parseRefinementResult(result.text || '', passResults);
}

function getAffectedArea(affectedField: string): string {
  if (affectedField.startsWith('action_items')) return 'action_items';
  if (affectedField.startsWith('customer_temperature') || affectedField.startsWith('temperature'))
    return 'customer_temperature';
  if (affectedField.startsWith('situation_summary')) return 'situation_summary';
  if (affectedField.startsWith('response_draft') || affectedField.startsWith('response_guidance'))
    return 'response_draft';
  return affectedField;
}

function buildCurrentAnalysisText(results: AllPassResults): string {
  const parts: string[] = [];

  if (results.situation) {
    parts.push(`SITUATION_SUMMARY: ${results.situation.situation_summary}`);
  }
  if (results.actionItems) {
    parts.push(`ACTION_ITEMS: ${JSON.stringify(results.actionItems.action_items, null, 2)}`);
  }
  if (results.temperature) {
    parts.push(`CUSTOMER_TEMPERATURE: ${results.temperature.customer_temperature}`);
    parts.push(`TEMPERATURE_REASON: ${results.temperature.temperature_reason}`);
  }
  if (results.responseDraft) {
    parts.push(`RESPONSE_GUIDANCE: ${results.responseDraft.response_guidance}`);
    parts.push(`RESPONSE_DRAFT: ${results.responseDraft.response_draft}`);
  }

  return parts.join('\n\n');
}

function parseRefinementResult(text: string, originalResults: AllPassResults): RefinementResult {
  const refined: RefinementResult = {};

  // Parse situation summary
  const situationMatch = text.match(/SITUATION_SUMMARY:\s*(.+?)(?=\n(?:ACTION_ITEMS|CUSTOMER_TEMPERATURE|RESPONSE_GUIDANCE|RESPONSE_DRAFT):|\n\n|$)/is);
  if (situationMatch) {
    refined.situation_summary = situationMatch[1].trim();
  }

  // Parse action items
  const actionMatch = text.match(/ACTION_ITEMS:\s*(\[[\s\S]*?\])(?=\n(?:CUSTOMER_TEMPERATURE|RESPONSE_GUIDANCE|RESPONSE_DRAFT|SITUATION_SUMMARY):|\n\n[A-Z]|$)/i);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        refined.action_items = parsed.map((item: Record<string, unknown>) => ({
          id: String(item.id || `refined-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          description: String(item.description || ''),
          who: String(item.who || 'support_agent'),
          priority: (['now', 'today', 'this_week'].includes(String(item.priority))
            ? String(item.priority)
            : 'today') as 'now' | 'today' | 'this_week',
          status_tags: Array.isArray(item.status_tags)
            ? item.status_tags.map(String)
            : originalResults.actionItems?.action_items[0]?.status_tags || [],
        }));
      }
    } catch {
      console.warn('Failed to parse refined action items');
    }
  }

  // Parse temperature
  const tempMatch = text.match(/CUSTOMER_TEMPERATURE:\s*(\w+)/i);
  if (tempMatch) {
    const validTemps = ['calm', 'frustrated', 'escalating', 'angry'];
    const rawTemp = tempMatch[1].toLowerCase();
    if (validTemps.includes(rawTemp)) {
      refined.customer_temperature = rawTemp;
    }
  }

  const reasonMatch = text.match(/TEMPERATURE_REASON:\s*(.+?)(?=\n(?:ACTION_ITEMS|SITUATION_SUMMARY|RESPONSE_GUIDANCE|RESPONSE_DRAFT):|\n\n|$)/is);
  if (reasonMatch) {
    refined.temperature_reason = reasonMatch[1].trim();
  }

  // Parse response draft
  const guidanceMatch = text.match(/RESPONSE_GUIDANCE:\s*(.+?)(?=\nRESPONSE_DRAFT:|\n\n|$)/is);
  if (guidanceMatch) {
    refined.response_guidance = guidanceMatch[1].trim();
  }

  const draftMatch = text.match(/RESPONSE_DRAFT:\s*(.+?)(?=\n(?:SITUATION_SUMMARY|ACTION_ITEMS|CUSTOMER_TEMPERATURE|RESPONSE_GUIDANCE):|\n\n[A-Z]|$)/is);
  if (draftMatch) {
    refined.response_draft = draftMatch[1].trim();
  }

  return refined;
}
