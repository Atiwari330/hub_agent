/**
 * Deal Activity Check using LLM
 *
 * Analyzes recent HubSpot engagements (emails, calls, notes, tasks)
 * to determine whether an AE is actively re-engaging a stalled deal.
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  ActivityCheckResult,
  ActivityCheckInput,
  EngagementVerdict,
} from '@/types/activity-check';

function getAnthropicProvider() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is not configured');
  }

  return createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Unknown date';
  const date = new Date(ts);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildActivityPrompt(input: ActivityCheckInput): string {
  const { deal, notes, emails, calls, tasks } = input;

  let prompt = `You are a RevOps analyst evaluating whether a sales rep is actively re-engaging a stalled deal. Analyze the ACTUAL engagement records below and determine if real outreach is happening.

TODAY'S DATE: ${formatTimestamp(new Date().toISOString())}

DEAL CONTEXT:
- Deal: "${deal.dealName}"
- AE: ${deal.ownerName}
- Amount: ${deal.amount ? `$${deal.amount.toLocaleString()}` : 'Unknown'}
- Stage: ${deal.stageName}
- Days inactive: ${deal.daysSinceActivity}
- Current next step: ${deal.nextStep ? `"${deal.nextStep}"` : 'None set'}
- Last activity date: ${deal.lastActivityDate ? formatTimestamp(deal.lastActivityDate) : 'Unknown'}

`;

  // Notes
  prompt += `RECENT NOTES (${notes.length} found):\n`;
  if (notes.length === 0) {
    prompt += 'None\n';
  } else {
    notes.forEach((note, i) => {
      const body = note.body ? note.body.substring(0, 500) : '(empty)';
      prompt += `[${i + 1}] ${formatTimestamp(note.timestamp)} - Author: ${note.authorName || 'Unknown'}\n"${body}"\n\n`;
    });
  }

  // Emails
  prompt += `\nRECENT EMAILS (${emails.length} found):\n`;
  if (emails.length === 0) {
    prompt += 'None\n';
  } else {
    emails.forEach((email, i) => {
      const direction = email.direction === 'INCOMING_EMAIL' ? 'INBOUND' : 'OUTBOUND';
      const body = email.body ? email.body.substring(0, 300) : '(empty)';
      prompt += `[${i + 1}] ${formatTimestamp(email.timestamp)} - ${direction}${email.fromEmail ? ` from ${email.fromEmail}` : ''} - Subject: "${email.subject}"\nBody: "${body}"\n\n`;
    });
  }

  // Calls
  prompt += `\nRECENT CALLS (${calls.length} found):\n`;
  if (calls.length === 0) {
    prompt += 'None\n';
  } else {
    calls.forEach((call, i) => {
      const duration = call.duration ? `${call.duration}s` : 'unknown duration';
      prompt += `[${i + 1}] ${formatTimestamp(call.timestamp)} - Duration: ${duration} - Disposition: ${call.disposition || 'unknown'}\nTitle: "${call.title || '(no title)'}"\n\n`;
    });
  }

  // Tasks
  prompt += `\nRECENT TASKS (${tasks.length} found):\n`;
  if (tasks.length === 0) {
    prompt += 'None\n';
  } else {
    tasks.forEach((task, i) => {
      prompt += `[${i + 1}] Status: ${task.status || 'unknown'} - Due: ${formatTimestamp(task.timestamp)}\nSubject: "${task.subject || '(no subject)'}"\n\n`;
    });
  }

  prompt += `ANALYSIS RULES:
STEP 1 - CALCULATE RECENCY GAP:
Before anything else, find the most recent OUTBOUND activity (email sent, call made, note logged about outreach) and compute the number of calendar days between that date and TODAY'S DATE above. This gap is the PRIMARY signal for your verdict.

STEP 2 - APPLY HARD RECENCY CUTOFFS:
- If the most recent outbound outreach is within the last 7 calendar days (5 business days): eligible for "actively_engaging"
- If the most recent outbound outreach is 8-14 days old: cap verdict at "minimal_effort" regardless of volume
- If the most recent outbound outreach is 15-21 days old: verdict should be "minimal_effort" or "no_engagement"
- If the most recent outbound outreach is >21 days old OR there is none: verdict must be "no_engagement"

STEP 3 - DETECT "BURST THEN SILENCE" PATTERN:
If there are multiple touches clustered in a short window (e.g., 3 calls in 2 days) but NOTHING since, and the gap from that burst to today is >7 days, this is "minimal_effort" — the AE tried but then gave up.

STEP 4 - EVALUATE QUALITY (only matters if recency passes):
- Focus on OUTBOUND activity (emails sent BY the AE, calls made, not automated or inbound)
- A logged note saying "left voicemail" is minimal; actual call log + email sent is stronger
- Multi-channel outreach (email + call) is stronger than single-channel
- Be skeptical of vague next steps without matching engagement evidence
- Automated email notifications (e.g., HubSpot system emails) do not count as outreach

VERDICT DEFINITIONS (from a CRO's perspective):
- "actively_engaging" = Outbound outreach within the last 7 calendar days, ideally multi-channel. The AE is clearly working this deal RIGHT NOW.
- "minimal_effort" = Some outreach exists but it's stale (>7 days old), OR only a single touch, OR a burst-then-silence pattern. The AE made some effort but is not currently active.
- "no_engagement" = No outbound activity found, or all activity is >21 days old. This deal is being neglected.
- "inconclusive" = Cannot determine (e.g., only inbound/automated activity, ambiguous records)

Respond with ONLY valid JSON:
{
  "verdict": "actively_engaging|minimal_effort|no_engagement|inconclusive",
  "confidence": 0.0-1.0,
  "summary": "1-2 sentence assessment",
  "evidence": {
    "recentEmails": <count of outbound emails>,
    "recentCalls": <count of calls made>,
    "recentNotes": <count of notes>,
    "recentTasks": <count of completed tasks>,
    "lastOutreachDate": "YYYY-MM-DD or null",
    "outreachTypes": ["email", "call", ...]
  },
  "details": "Detailed paragraph explaining the evidence and reasoning"
}`;

  return prompt;
}

function parseActivityResponse(responseText: string): Omit<ActivityCheckResult, 'checkedAt'> {
  let jsonStr = responseText.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);

    const validVerdicts: EngagementVerdict[] = [
      'actively_engaging',
      'minimal_effort',
      'no_engagement',
      'inconclusive',
    ];

    const verdict: EngagementVerdict = validVerdicts.includes(parsed.verdict)
      ? parsed.verdict
      : 'inconclusive';

    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    const summary =
      typeof parsed.summary === 'string' && parsed.summary.length > 0
        ? parsed.summary.substring(0, 500)
        : 'Unable to determine engagement level.';

    const details =
      typeof parsed.details === 'string' && parsed.details.length > 0
        ? parsed.details.substring(0, 2000)
        : '';

    const evidence = {
      recentEmails: typeof parsed.evidence?.recentEmails === 'number' ? parsed.evidence.recentEmails : 0,
      recentCalls: typeof parsed.evidence?.recentCalls === 'number' ? parsed.evidence.recentCalls : 0,
      recentNotes: typeof parsed.evidence?.recentNotes === 'number' ? parsed.evidence.recentNotes : 0,
      recentTasks: typeof parsed.evidence?.recentTasks === 'number' ? parsed.evidence.recentTasks : 0,
      lastOutreachDate: typeof parsed.evidence?.lastOutreachDate === 'string' ? parsed.evidence.lastOutreachDate : null,
      outreachTypes: Array.isArray(parsed.evidence?.outreachTypes) ? parsed.evidence.outreachTypes : [],
    };

    return { verdict, confidence, summary, evidence, details };
  } catch {
    return {
      verdict: 'inconclusive',
      confidence: 0,
      summary: 'Could not parse activity analysis response.',
      evidence: {
        recentEmails: 0,
        recentCalls: 0,
        recentNotes: 0,
        recentTasks: 0,
        lastOutreachDate: null,
        outreachTypes: [],
      },
      details: '',
    };
  }
}

/**
 * Analyze deal engagement activity using AI
 */
export async function checkDealActivity(
  input: ActivityCheckInput
): Promise<ActivityCheckResult> {
  // If there are zero engagements across all types, skip AI call
  const totalEngagements =
    input.notes.length + input.emails.length + input.calls.length + input.tasks.length;

  if (totalEngagements === 0) {
    return {
      verdict: 'no_engagement',
      confidence: 0.95,
      summary: 'No engagement records found for this deal. There are no emails, calls, notes, or tasks.',
      evidence: {
        recentEmails: 0,
        recentCalls: 0,
        recentNotes: 0,
        recentTasks: 0,
        lastOutreachDate: null,
        outreachTypes: [],
      },
      details: 'A search of all engagement types (emails, calls, notes, tasks) returned zero results for this deal. The AE has not logged any outreach activity.',
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const anthropic = getAnthropicProvider();
    const prompt = buildActivityPrompt(input);

    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      prompt,
    });

    const parsed = parseActivityResponse(result.text);
    return {
      ...parsed,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error checking deal activity:', error);

    return {
      verdict: 'inconclusive',
      confidence: 0,
      summary: 'Activity analysis failed due to an error.',
      evidence: {
        recentEmails: 0,
        recentCalls: 0,
        recentNotes: 0,
        recentTasks: 0,
        lastOutreachDate: null,
        outreachTypes: [],
      },
      details: '',
      checkedAt: new Date().toISOString(),
    };
  }
}
