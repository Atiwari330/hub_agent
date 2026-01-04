/**
 * AI-powered exception context generator
 * Transforms exception symptoms into diagnosis + recommended action
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ExceptionContext, ExceptionContextInput, ExceptionUrgency } from '@/types/exception-context';

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

const SYSTEM_PROMPT = `You are a RevOps analyst diagnosing why deals need attention.

Given a deal's properties, exception type, and recent notes, provide:

1. DIAGNOSIS: One sentence explaining the ROOT CAUSE of why this deal is flagged
2. RECENT_ACTIVITY: 2-3 sentence timeline of what happened (use dates and names from notes)
3. RECOMMENDED_ACTION: Specific action the rep should take TODAY
4. URGENCY: critical/high/medium/low

Urgency guidelines:
- CRITICAL: $50k+ deals with close date past OR multiple overdue actions
- HIGH: Any deal with 2+ risk factors OR high-value needing action today
- MEDIUM: Single risk factor, deal progressing but needs attention
- LOW: Minor hygiene issue, deal otherwise healthy

Rules:
- Be specific. Use names, dates, and dollar amounts from the data.
- Keep total response under 100 words.
- Output valid JSON only, no markdown.
- If no notes exist, acknowledge this in recent_activity and recommend getting an update.`;

/**
 * Format a date string for display
 */
function formatDate(timestamp: string | null): string {
  if (!timestamp) return 'Unknown date';
  try {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown date';
  }
}

/**
 * Truncate text to a maximum length
 */
function truncate(text: string | null, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Build the prompt for the AI model
 */
function buildPrompt(input: ExceptionContextInput): string {
  const { deal, exceptionType, exceptionDetail, notes, sentiment } = input;

  const notesText = notes.length > 0
    ? notes.map(n => `[${formatDate(n.timestamp)}] ${n.authorName || 'Unknown'}: ${truncate(n.body, 200)}`).join('\n')
    : 'No notes recorded.';

  return `DEAL CONTEXT:
- Name: ${deal.dealName}
- Amount: ${deal.amount ? `$${deal.amount.toLocaleString()}` : 'Not set'}
- Stage: ${deal.stageName} (${deal.daysInStage} days in stage)
- Close Date: ${deal.closeDate || 'Not set'}
- Days Since Activity: ${deal.daysSinceActivity}
- Next Step: "${deal.nextStep || 'None'}"${deal.nextStepDueDate ? ` (due: ${deal.nextStepDueDate})` : ''}
- Sentiment: ${sentiment?.score || 'Not analyzed'}${sentiment?.summary ? ` - ${sentiment.summary}` : ''}

EXCEPTION: ${exceptionType.replace(/_/g, ' ')}
DETAIL: ${exceptionDetail}

RECENT NOTES (newest first):
${notesText}

Analyze and respond with JSON:
{
  "diagnosis": "...",
  "recentActivity": "...",
  "recommendedAction": "...",
  "urgency": "critical|high|medium|low",
  "confidence": 0.0-1.0
}`;
}

/**
 * Parse the AI response into structured data
 */
function parseResponse(text: string): ExceptionContext {
  // Try to extract JSON from the response
  let jsonText = text.trim();

  // Handle markdown code blocks
  if (jsonText.startsWith('```')) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonText = match[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(jsonText);

    // Validate and sanitize the response
    const urgency = ['critical', 'high', 'medium', 'low'].includes(parsed.urgency)
      ? parsed.urgency as ExceptionUrgency
      : 'medium';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7;

    return {
      diagnosis: String(parsed.diagnosis || 'Unable to diagnose'),
      recentActivity: String(parsed.recentActivity || 'No activity information available'),
      recommendedAction: String(parsed.recommendedAction || 'Review deal and update status'),
      urgency,
      confidence,
    };
  } catch (error) {
    console.error('Failed to parse AI response:', error, 'Raw text:', text);

    // Return a fallback response
    return {
      diagnosis: 'Unable to generate diagnosis',
      recentActivity: 'Could not analyze activity history',
      recommendedAction: 'Review deal manually and update status',
      urgency: 'medium',
      confidence: 0.3,
    };
  }
}

/**
 * Generate AI-powered context for an exception deal
 */
export async function generateExceptionContext(
  input: ExceptionContextInput
): Promise<ExceptionContext> {
  const prompt = buildPrompt(input);

  try {
    const anthropic = getAnthropicProvider();
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: SYSTEM_PROMPT,
      prompt,
    });

    return parseResponse(result.text);
  } catch (error) {
    console.error('Failed to generate exception context:', error);

    // Return a fallback response
    return {
      diagnosis: 'AI analysis unavailable',
      recentActivity: 'Could not analyze activity history',
      recommendedAction: 'Review deal manually',
      urgency: 'medium',
      confidence: 0,
    };
  }
}

/**
 * Build a human-readable exception detail string
 */
export function buildExceptionDetail(
  exceptionType: string,
  deal: { close_date?: string | null; next_step_due_date?: string | null },
  daysSinceActivity: number
): string {
  const now = new Date();

  switch (exceptionType) {
    case 'overdue_next_step': {
      if (deal.next_step_due_date) {
        const dueDate = new Date(deal.next_step_due_date);
        const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        return `Next step was due ${daysOverdue} day(s) ago`;
      }
      return 'Next step is overdue';
    }
    case 'past_close_date': {
      if (deal.close_date) {
        const closeDate = new Date(deal.close_date);
        const daysPast = Math.floor((now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24));
        return `Close date passed ${daysPast} day(s) ago`;
      }
      return 'Close date has passed';
    }
    case 'activity_drought':
      return `No activity in ${daysSinceActivity} days`;
    case 'high_value_at_risk':
      return 'High-value deal with multiple risk factors';
    case 'no_next_step':
      return 'No next step defined for this active deal';
    case 'stale_stage':
      return 'Deal has been stuck in current stage too long';
    default:
      return 'Exception detected';
  }
}
