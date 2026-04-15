import { generateText } from 'ai';
import { getModelForPass } from './models';
import { normalizeFieldHeaders } from '@/lib/ai/parsing/normalize-field-headers';
import type { TicketContext, TemperaturePassResult } from './types';
import type { TicketChanges } from '@/lib/ai/memory/change-detector';

export async function runTemperaturePass(
  context: TicketContext,
  changes?: TicketChanges | null
): Promise<TemperaturePassResult> {
  const model = getModelForPass('temperature');
  const isUpdate = changes && !changes.isFirstAnalysis && changes.previous.temperature;

  const systemPrompt = isUpdate
    ? `You are a customer sentiment analyst for a healthcare SaaS support team.

You previously assessed this customer's temperature. Your job is to UPDATE the assessment based on what changed.

CONTINUITY RULES:
- Temperature has momentum. If you previously assessed "frustrated", don't flip to "calm" unless there's clear evidence of improvement (customer thanked the team, issue was resolved, etc.).
- Escalation is sticky — once a customer starts escalating, they rarely de-escalate without concrete resolution.
- If nothing meaningful changed, keep the same temperature. Don't fluctuate randomly.
- If the temperature genuinely changed, briefly explain WHY in the reason.

Output EXACTLY two fields:

CUSTOMER_TEMPERATURE: One of: calm | frustrated | escalating | angry

TEMPERATURE_REASON: One sentence explaining your assessment, noting any change from previous.`
    : `You are a customer sentiment analyst for a healthcare SaaS support team.

Analyze the customer's tone, word choice, and communication patterns across the full conversation thread. Consider:
- Explicit frustration signals (demanding, threatening, all caps, repeated follow-ups)
- Implicit signals (increasingly terse replies, formal tone shift, CC'ing managers)
- Trend direction: is sentiment improving or deteriorating?
- Time pressure: how long have they been waiting?

Output EXACTLY two fields:

CUSTOMER_TEMPERATURE: One of: calm | frustrated | escalating | angry

TEMPERATURE_REASON: One sentence explaining your assessment.`;

  let userPrompt = `TICKET: ${context.ticket.subject || 'N/A'}
COMPANY: ${context.ticket.hs_primary_company_name || 'Unknown'}
AGE: ${context.ageDays !== null ? `${context.ageDays} days` : 'Unknown'}
LAST CUSTOMER MESSAGE: ${context.ticket.last_customer_message_at || 'Unknown'}
LAST AGENT MESSAGE: ${context.ticket.last_agent_message_at || 'Unknown'}
CO-DESTINY (VIP): ${context.ticket.is_co_destiny ? 'YES' : 'No'}`;

  // Add memory context for update mode
  if (isUpdate && changes) {
    userPrompt += `\n\nPREVIOUS TEMPERATURE: ${changes.previous.temperature}
PREVIOUS REASON: ${changes.previous.temperatureReason || '(none)'}
TIME SINCE LAST ASSESSMENT: ${formatTimeSince(changes.timeSinceLastAnalysis)}

WHAT CHANGED:
${changes.changeSummary}`;
  }

  userPrompt += `\n\nFULL CONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  const text = normalizeFieldHeaders(result.text || '');

  const tempMatch = text.match(/CUSTOMER_TEMPERATURE:\s*(\w+)/i);
  const reasonMatch = text.match(/TEMPERATURE_REASON:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);

  const rawTemp = (tempMatch?.[1] || 'calm').toLowerCase();
  const validTemps = ['calm', 'frustrated', 'escalating', 'angry'];
  const temperature = validTemps.includes(rawTemp) ? rawTemp : 'calm';

  return {
    customer_temperature: temperature,
    temperature_reason: reasonMatch?.[1]?.trim() || '',
  };
}

function formatTimeSince(hours: number | null): string {
  if (hours === null) return 'unknown time';
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
