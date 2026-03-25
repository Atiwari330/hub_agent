import { generateText } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import type { TicketContext, SituationPassResult } from './types';

export async function runSituationPass(context: TicketContext): Promise<SituationPassResult> {
  const model = getModelForPass('situation');

  const systemPrompt = `You are an operations analyst for a healthcare SaaS support team.

Your task: Summarize this support ticket for someone with ZERO context. What's going on, where do things stand?

Output EXACTLY two fields:

SITUATION_SUMMARY: 2-3 sentences. Include the customer name, the core issue, and current status. Written so any agent picking this up understands the full picture.

CONTEXT_SNAPSHOT: 2-3 sentence engagement recap. Who said what, what was tried, where things stand.`;

  const userPrompt = `${buildTicketMetadataSection(context)}

CONVERSATION THREAD (${context.conversationMessages.length} messages):
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
