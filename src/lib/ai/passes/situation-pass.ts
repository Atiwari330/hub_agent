import { generateText } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import type { TicketContext, SituationPassResult } from './types';
import type { TicketChanges } from '@/lib/ai/memory/change-detector';

export async function runSituationPass(
  context: TicketContext,
  changes?: TicketChanges | null
): Promise<SituationPassResult> {
  const model = getModelForPass('situation');
  const isUpdate = changes && !changes.isFirstAnalysis && changes.previous.situationSummary;

  const systemPrompt = isUpdate
    ? `You are an operations analyst for a healthcare SaaS support team.

You previously analyzed this ticket and wrote a situation summary. Since then, things may have changed. Your job is to UPDATE the summary — not rewrite it from scratch.

CONTINUITY RULES:
- Build on your previous summary. Don't contradict it unless new evidence warrants a change.
- Focus on what's NEW or DIFFERENT. Don't repeat unchanged context.
- If nothing meaningful changed, you can keep the summary mostly the same with minor updates (e.g., updated timing).
- The summary should still be readable by someone with zero context — it's a complete picture, not just a diff.

Output EXACTLY two fields:

SITUATION_SUMMARY: 2-3 sentences. The updated full picture — what's going on now, reflecting the latest changes.

CONTEXT_SNAPSHOT: 2-3 sentence engagement recap. Who said what recently, where things stand now.`
    : `You are an operations analyst for a healthcare SaaS support team.

Your task: Summarize this support ticket for someone with ZERO context. What's going on, where do things stand?

Output EXACTLY two fields:

SITUATION_SUMMARY: 2-3 sentences. Include the customer name, the core issue, and current status. Written so any agent picking this up understands the full picture.

CONTEXT_SNAPSHOT: 2-3 sentence engagement recap. Who said what, what was tried, where things stand.`;

  let userPrompt = `${buildTicketMetadataSection(context)}`;

  // Add memory context for update mode
  if (isUpdate && changes) {
    userPrompt += `\n\nPREVIOUS SITUATION SUMMARY (from ${formatTimeSince(changes.timeSinceLastAnalysis)} ago):
${changes.previous.situationSummary}

PREVIOUS CONTEXT SNAPSHOT:
${changes.previous.contextSnapshot || '(none)'}

WHAT CHANGED SINCE THEN:
${changes.changeSummary}`;
  }

  userPrompt += `\n\nCONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}

ENGAGEMENT TIMELINE (${context.engagementTimeline.engagements.length} items):
${context.engagementTimelineText}${context.linearContext ? `\n\n${buildLinearSection(context)}` : ''}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  const text = result.text || '';

  const situationMatch = text.match(/SITUATION_SUMMARY:\s*(.+?)(?=\nCONTEXT_SNAPSHOT:|\n\n|$)/is);
  const contextMatch = text.match(/CONTEXT_SNAPSHOT:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);

  return {
    situation_summary: situationMatch?.[1]?.trim() || 'No summary available.',
    context_snapshot: contextMatch?.[1]?.trim() || '',
  };
}

function formatTimeSince(hours: number | null): string {
  if (hours === null) return 'unknown time';
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
