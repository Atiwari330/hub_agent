/**
 * Smart Task Generation using LLM
 *
 * Generates professional HubSpot task titles and descriptions from
 * natural language input, with context about the deal or company.
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

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

// Input schema for task generation
export const GenerateTaskInputSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  dealName: z.string().optional(),
  companyName: z.string().optional(),
  ownerName: z.string().optional(),
  stageName: z.string().optional(),
  queueType: z.enum(['hygiene', 'next-step', 'cs-hygiene', 'other']).default('other'),
  missingFields: z.array(z.string()).optional(),
});

export type GenerateTaskInput = z.infer<typeof GenerateTaskInputSchema>;

// Output schema for generated task content
export const GeneratedTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  suggestedPriority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

export type GeneratedTask = z.infer<typeof GeneratedTaskSchema>;

/**
 * Build the prompt for task generation
 */
function buildTaskPrompt(input: GenerateTaskInput): string {
  const contextParts: string[] = [];

  if (input.dealName) {
    contextParts.push(`Deal: ${input.dealName}`);
  }
  if (input.companyName) {
    contextParts.push(`Company: ${input.companyName}`);
  }
  if (input.ownerName) {
    contextParts.push(`Owner: ${input.ownerName}`);
  }
  if (input.stageName) {
    contextParts.push(`Stage: ${input.stageName}`);
  }
  if (input.missingFields && input.missingFields.length > 0) {
    contextParts.push(`Missing Fields: ${input.missingFields.join(', ')}`);
  }

  const contextSection = contextParts.length > 0
    ? `CONTEXT:\n${contextParts.join('\n')}\n\n`
    : '';

  const queueDescription = {
    'hygiene': 'deal hygiene (data quality, missing fields)',
    'next-step': 'next step follow-up (deal progression)',
    'cs-hygiene': 'customer success hygiene (account management)',
    'other': 'general CRM task',
  }[input.queueType];

  return `You are a helpful assistant that creates professional HubSpot CRM tasks for sales and customer success teams.

${contextSection}QUEUE TYPE: ${queueDescription}

USER REQUEST:
"${input.prompt}"

Generate a professional task based on the user's request. The task should be:
1. Clear and actionable
2. Professional in tone
3. Specific enough to be useful
4. Appropriate for the context (${queueDescription})

RESPONSE FORMAT:
Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "title": "<task title, max 100 characters, be concise>",
  "description": "<detailed task description, 1-3 sentences explaining what needs to be done>",
  "suggestedPriority": "<LOW, MEDIUM, or HIGH based on urgency implied in the request>"
}

PRIORITY GUIDELINES:
- HIGH: Urgent requests, time-sensitive, customer-facing issues, blockers
- MEDIUM: Standard follow-ups, routine tasks, regular cadence items
- LOW: Nice-to-have, non-urgent administrative tasks

TITLE GUIDELINES:
- Start with an action verb (Update, Follow up, Schedule, Review, etc.)
- Include the deal/company name if provided
- Be specific but concise
- Examples: "Follow up on proposal status", "Update missing fields: Lead Source, Products", "Schedule discovery call"`;
}

/**
 * Parse the LLM response into a GeneratedTask object
 */
function parseTaskResponse(responseText: string): GeneratedTask {
  let jsonStr = responseText.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate the response
    const validPriorities = ['LOW', 'MEDIUM', 'HIGH'];
    const priority = validPriorities.includes(parsed.suggestedPriority)
      ? parsed.suggestedPriority
      : 'MEDIUM';

    const title = typeof parsed.title === 'string' && parsed.title.length > 0
      ? parsed.title.substring(0, 200)
      : 'Follow up on deal';

    const description = typeof parsed.description === 'string' && parsed.description.length > 0
      ? parsed.description.substring(0, 2000)
      : 'Please review and take appropriate action.';

    return {
      title,
      description,
      suggestedPriority: priority as 'LOW' | 'MEDIUM' | 'HIGH',
    };
  } catch {
    // Return a fallback if parsing fails
    return {
      title: 'Follow up on deal',
      description: 'Please review and take appropriate action.',
      suggestedPriority: 'MEDIUM',
    };
  }
}

/**
 * Generate task content from natural language input
 */
export async function generateTaskContent(
  input: GenerateTaskInput
): Promise<GeneratedTask> {
  // Validate input
  const validated = GenerateTaskInputSchema.parse(input);

  try {
    const anthropic = getAnthropicProvider();
    const prompt = buildTaskPrompt(validated);

    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      prompt,
    });

    return parseTaskResponse(result.text);
  } catch (error) {
    console.error('Error generating task content:', error);

    // Return a reasonable fallback
    const entityName = validated.dealName || validated.companyName || 'this record';
    return {
      title: `Follow up: ${entityName}`,
      description: validated.prompt,
      suggestedPriority: 'MEDIUM',
    };
  }
}
