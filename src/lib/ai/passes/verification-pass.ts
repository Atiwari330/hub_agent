import { generateText } from 'ai';
import { getModelForPass } from './models';
import { normalizeFieldHeaders } from '@/lib/ai/parsing/normalize-field-headers';
import type { TicketContext, VerificationPassResult } from './types';

export async function runVerificationPass(context: TicketContext): Promise<VerificationPassResult> {
  const model = getModelForPass('verification');

  const unverified = context.recentCompletions.filter((c) => c.verified === null);
  if (unverified.length === 0) {
    return { verifications: [] };
  }

  const systemPrompt = `You are an action completion auditor for a healthcare SaaS support team.

For each claimed action completion below, verify whether the action actually happened based on the conversation thread and engagement timeline.

Output a JSON array called VERIFICATIONS where each item has:
- "completionId": the completion ID
- "verified": true if evidence supports the action was done, false if not
- "note": brief explanation of what evidence you found (or didn't find)`;

  const completionsList = unverified.map((c) =>
    `- ID: ${c.id} | Action: "${c.action_description}" | Claimed by: ${c.completed_by_name} at ${c.completed_at}`
  ).join('\n');

  const userPrompt = `CLAIMED COMPLETIONS TO VERIFY:
${completionsList}

CONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}

ENGAGEMENT TIMELINE (${context.engagementTimeline.engagements.length} items):
${context.engagementTimelineText}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  const text = normalizeFieldHeaders(result.text || '');

  let verifications: VerificationPassResult['verifications'] = [];
  try {
    const match = text.match(/VERIFICATIONS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        verifications = parsed.map((v: Record<string, unknown>) => ({
          completionId: (v.completionId as string) || '',
          actionDescription: '',
          verified: v.verified === true,
          note: (v.note as string) || '',
        }));
      }
    }
  } catch (err) {
    console.warn('Could not parse VERIFICATIONS JSON:', err);
  }

  // Fill in action descriptions from context
  for (const v of verifications) {
    const completion = context.recentCompletions.find((c) => c.id === v.completionId);
    if (completion) {
      v.actionDescription = completion.action_description;
    }
  }

  return { verifications };
}
