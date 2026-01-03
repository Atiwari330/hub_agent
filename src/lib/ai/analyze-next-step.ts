/**
 * Next Step Analysis using LLM
 *
 * Extracts expected action dates from free-text "next step" fields.
 * Uses structured prompting to classify and extract dates.
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type {
  NextStepAnalysis,
  NextStepStatus,
  NextStepActionType,
  NextStepExtractionInput,
} from '@/types/next-step-analysis';

// Create Anthropic provider via AI Gateway
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

/**
 * Format a date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Build the extraction prompt
 */
function buildExtractionPrompt(
  nextStepText: string,
  referenceDate: Date
): string {
  const today = formatDate(referenceDate);

  return `Extract the expected action date from this sales "next step" field.

Today's date is: ${today}

CLASSIFICATION RULES:
1. "date_found" - An explicit date is mentioned (e.g., "Jan 15", "January 15th 2026", "1/15/26")
2. "date_inferred" - A relative date that can be calculated (e.g., "next Tuesday", "end of week", "in 2 weeks", "next month")
3. "date_unclear" - Vague timeframes that cannot be calculated (e.g., "soon", "when ready", "ASAP", "shortly")
4. "awaiting_external" - Waiting on someone else's action (e.g., "waiting on their legal team", "pending customer response", "ball in their court")
5. "no_date" - No date or timeframe mentioned at all (e.g., "need to connect with CFO", "discuss pricing")
6. "empty" - The text is blank, empty, or only whitespace
7. "unparseable" - The text is nonsense, gibberish, or completely unrelated to sales actions

ACTION TYPE RULES:
- "demo" - Demo, presentation, or product walkthrough
- "call" - Phone call, video call
- "email" - Send email, follow up via email
- "proposal" - Send proposal, quote, pricing
- "meeting" - General meeting (not demo)
- "follow_up" - Generic follow-up action
- "contract" - Contract review, signature, negotiation
- "security_review" - Security questionnaire, BAA, compliance
- "other" - None of the above
- null - Cannot determine action type

RESPONSE FORMAT:
Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "status": "<one of the status values above>",
  "dueDate": "<YYYY-MM-DD format or null>",
  "confidence": <0.0 to 1.0>,
  "displayMessage": "<short human-readable summary, max 50 chars>",
  "actionType": "<one of the action types above or null>"
}

CONFIDENCE GUIDELINES:
- 0.95-1.0: Explicit date mentioned
- 0.80-0.94: Relative date that's clear (e.g., "next Tuesday")
- 0.60-0.79: Relative date that's ambiguous (e.g., "end of next week")
- 0.40-0.59: Inferred from context
- Below 0.40: Uncertain

EXAMPLES:
Input: "Demo scheduled for Jan 15th at 2pm"
Output: {"status":"date_found","dueDate":"2026-01-15","confidence":0.98,"displayMessage":"Demo due Jan 15","actionType":"demo"}

Input: "Follow up next Tuesday"
Output: {"status":"date_inferred","dueDate":"2026-01-07","confidence":0.85,"displayMessage":"Follow up due Jan 7","actionType":"follow_up"}

Input: "Waiting on their legal team to review BAA"
Output: {"status":"awaiting_external","dueDate":null,"confidence":0.90,"displayMessage":"Awaiting legal review","actionType":"security_review"}

Input: "TBD"
Output: {"status":"no_date","dueDate":null,"confidence":0.95,"displayMessage":"No date specified","actionType":null}

Input: ""
Output: {"status":"empty","dueDate":null,"confidence":1.0,"displayMessage":"No next step entered","actionType":null}

---
NEXT STEP TEXT TO ANALYZE:
"${nextStepText}"`;
}

/**
 * Parse the LLM response into a NextStepAnalysis object
 */
function parseAnalysisResponse(responseText: string): NextStepAnalysis {
  // Try to extract JSON from the response
  let jsonStr = responseText.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize the response
    const validStatuses: NextStepStatus[] = [
      'date_found',
      'date_inferred',
      'no_date',
      'date_unclear',
      'awaiting_external',
      'empty',
      'unparseable',
    ];

    const validActionTypes: NextStepActionType[] = [
      'demo',
      'call',
      'email',
      'proposal',
      'meeting',
      'follow_up',
      'contract',
      'security_review',
      'other',
      null,
    ];

    const status: NextStepStatus = validStatuses.includes(parsed.status)
      ? parsed.status
      : 'unparseable';

    const actionType: NextStepActionType = validActionTypes.includes(
      parsed.actionType
    )
      ? parsed.actionType
      : null;

    // Validate dueDate format if present
    let dueDate: string | null = null;
    if (parsed.dueDate && typeof parsed.dueDate === 'string') {
      const dateMatch = parsed.dueDate.match(/^\d{4}-\d{2}-\d{2}$/);
      if (dateMatch) {
        dueDate = parsed.dueDate;
      }
    }

    // Normalize confidence to 0-1 range
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    // Get display message or generate default
    const displayMessage =
      typeof parsed.displayMessage === 'string' && parsed.displayMessage.length > 0
        ? parsed.displayMessage.substring(0, 100)
        : getDefaultDisplayMessage(status, dueDate, actionType);

    return {
      status,
      dueDate,
      confidence,
      displayMessage,
      actionType,
    };
  } catch {
    // If parsing fails, return unparseable result
    return {
      status: 'unparseable',
      dueDate: null,
      confidence: 0,
      displayMessage: 'Could not parse response',
      actionType: null,
    };
  }
}

/**
 * Generate a default display message based on status
 */
function getDefaultDisplayMessage(
  status: NextStepStatus,
  dueDate: string | null,
  actionType: NextStepActionType
): string {
  switch (status) {
    case 'date_found':
    case 'date_inferred':
      if (dueDate) {
        const date = new Date(dueDate);
        const formatted = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        const actionPrefix = actionType
          ? actionType.charAt(0).toUpperCase() + actionType.slice(1).replace('_', ' ')
          : 'Due';
        return `${actionPrefix} ${formatted}`;
      }
      return 'Date extracted';
    case 'no_date':
      return 'No date specified';
    case 'date_unclear':
      return 'Timeframe unclear';
    case 'awaiting_external':
      return 'Awaiting external party';
    case 'empty':
      return 'No next step entered';
    case 'unparseable':
      return 'Could not parse';
    default:
      return 'Unknown status';
  }
}

/**
 * Analyze a next step text and extract expected action date
 */
export async function analyzeNextStep(
  input: NextStepExtractionInput
): Promise<NextStepAnalysis> {
  const { nextStepText, referenceDate = new Date() } = input;

  // Handle empty/null input without calling LLM
  if (!nextStepText || nextStepText.trim().length === 0) {
    return {
      status: 'empty',
      dueDate: null,
      confidence: 1.0,
      displayMessage: 'No next step entered',
      actionType: null,
    };
  }

  // Handle very short input (likely not useful)
  const trimmed = nextStepText.trim();
  if (trimmed.length < 3) {
    return {
      status: 'unparseable',
      dueDate: null,
      confidence: 0.9,
      displayMessage: 'Text too short',
      actionType: null,
    };
  }

  try {
    const anthropic = getAnthropicProvider();
    const prompt = buildExtractionPrompt(trimmed, referenceDate);

    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      prompt,
    });

    return parseAnalysisResponse(result.text);
  } catch (error) {
    console.error('Error analyzing next step:', error);

    // Return a fallback result on error
    return {
      status: 'unparseable',
      dueDate: null,
      confidence: 0,
      displayMessage: 'Analysis failed',
      actionType: null,
    };
  }
}

/**
 * Batch analyze multiple next steps (for efficiency)
 * Uses sequential calls to avoid rate limiting
 */
export async function analyzeNextStepsBatch(
  inputs: Array<{ dealId: string; nextStepText: string | null }>,
  referenceDate: Date = new Date()
): Promise<Map<string, NextStepAnalysis>> {
  const results = new Map<string, NextStepAnalysis>();

  for (const input of inputs) {
    const analysis = await analyzeNextStep({
      nextStepText: input.nextStepText,
      referenceDate,
    });
    results.set(input.dealId, analysis);
  }

  return results;
}
