import { generateText } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection } from './gather-context';
import type { TicketContext, ResponseDraftPassResult, ActionItem } from './types';

interface ResponseDraftDeps {
  actionItems?: ActionItem[];
  temperature?: string;
}

export async function runResponseDraftPass(
  context: TicketContext,
  deps?: ResponseDraftDeps
): Promise<ResponseDraftPassResult> {
  const model = getModelForPass('response_draft');

  const systemPrompt = `You are a response drafting assistant for a healthcare SaaS support team at Opus Behavioral Health.

Draft a response the support agent can edit and send to the customer. The response should:
- Address the customer's most recent message or concern
- Match the appropriate tone for the customer's current temperature
- Be professional but warm — this is healthcare, empathy matters
- Include specific next steps or information, not vague promises
- Be concise (2-4 paragraphs max)

Output EXACTLY two fields:

RESPONSE_GUIDANCE: 1-2 sentences of internal guidance for the agent (what to cover, what tone to use, any warnings). This is NOT shown to the customer.

RESPONSE_DRAFT: The actual draft message the agent can send (or edit and send).`;

  let userPrompt = buildTicketMetadataSection(context);

  if (deps?.temperature) {
    userPrompt += `\n\nCUSTOMER TEMPERATURE: ${deps.temperature}`;
  }

  if (deps?.actionItems && deps.actionItems.length > 0) {
    userPrompt += `\n\nPENDING ACTION ITEMS:\n` +
      deps.actionItems.map((a) => `- [${a.priority}] ${a.description}`).join('\n');
  }

  if (context.customerContext) {
    userPrompt += `\n\nCUSTOMER CONTEXT:\n${context.customerContext}`;
  }

  userPrompt += `\n\nCONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  const text = result.text || '';

  const guidanceMatch = text.match(/RESPONSE_GUIDANCE:\s*(.+?)(?=\nRESPONSE_DRAFT:|\n\n|$)/is);
  const draftMatch = text.match(/RESPONSE_DRAFT:\s*([\s\S]+?)(?=\n[A-Z_]+:|\n\n$|$)/is);

  return {
    response_guidance: guidanceMatch?.[1]?.trim() || '',
    response_draft: draftMatch?.[1]?.trim() || '',
  };
}
