import { generateText } from 'ai';
import { getDeepSeekModel } from '@/lib/ai/provider';
import type { CompanyGroup } from './data';

export async function synthesizeCompanySummaries(
  companies: CompanyGroup[]
): Promise<CompanyGroup[]> {
  if (companies.length === 0) return companies;

  const companyBlocks = companies.map((c) => {
    const ticketLines = c.tickets
      .map(
        (t) =>
          `- [${t.urgency?.toUpperCase() || 'UNKNOWN'}] "${t.subject || 'No subject'}"${t.customerTemperature ? ` (customer: ${t.customerTemperature})` : ''}${t.daysSinceLastActivity != null ? ` — ${t.daysSinceLastActivity}d since last activity` : ''}${t.issueSummary ? `\n  Summary: ${t.issueSummary}` : ''}${t.nextAction ? `\n  Next: ${t.nextAction}` : ''}`
      )
      .join('\n');
    return `## ${c.companyName}\n${ticketLines}`;
  }).join('\n\n');

  const prompt = `You are writing a daily Co-Destiny VIP ticket briefing for Opus Behavioral Health leadership: CTO, Head of Client Success, Head of Customer Support, and VP of RevOps.

They understand the billing process (PracticeSuite, ImaginePay), vendor relationships, EHR/RCM workflows, and Copilot AI. Do NOT over-explain domain concepts. Write like you're briefing a colleague.

For each company below, write exactly ONE sentence (two max if the situation is complex) summarizing the overall status and what needs attention. Be direct and specific — name the blocking issue, not generic statements.

${companyBlocks}

Respond with one section per company in this exact format (no markdown, no extra text):
COMPANY: <company name>
SUMMARY: <your 1-2 sentence summary>`;

  try {
    const result = await generateText({
      model: getDeepSeekModel(),
      prompt,
    });

    const text = result.text;
    const summaryMap = new Map<string, string>();

    const sections = text.split(/\nCOMPANY:\s*/i).filter(Boolean);
    for (const section of sections) {
      const lines = section.trim().split('\n');
      const companyLine = lines[0]?.replace(/^COMPANY:\s*/i, '').trim();
      const summaryLine = lines
        .find((l) => l.trim().startsWith('SUMMARY:'))
        ?.replace(/^SUMMARY:\s*/i, '')
        .trim();

      if (companyLine && summaryLine) {
        summaryMap.set(companyLine.toLowerCase(), summaryLine);
      }
    }

    return companies.map((c) => ({
      ...c,
      companySummary: summaryMap.get(c.companyName.toLowerCase()) || undefined,
    }));
  } catch (error) {
    console.error('Co-Destiny synthesis LLM call failed, proceeding without summaries:', error);
    return companies;
  }
}
