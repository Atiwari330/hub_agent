import { generateText, streamText, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  listOwnersTool,
  getOwnerByEmailTool,
  getDealsByOwnerTool,
  getDealDetailsTool,
  analyzeDealSentimentTool,
  summarizeDealsTool,
  getPipelinesTool,
} from './tools';

// System prompt for the RevOps agent
export const REVOPS_AGENT_SYSTEM_PROMPT = `You are a RevOps AI Assistant, specialized in helping revenue operations teams analyze HubSpot CRM data.

Your capabilities:
1. Look up account executives (owners) by name or email
2. Retrieve deals for specific AEs
3. Get detailed deal information including notes
4. Analyze deal sentiment based on notes and activity
5. Summarize deal pipelines and metrics
6. Look up pipeline and stage definitions to translate stage IDs to readable names

When answering questions:
- Be precise with numbers and data
- When analyzing sentiment, explain your reasoning based on the deal notes and activity
- If asked about an AE by first name only, first use listOwners to find matching owners and confirm identity
- Proactively surface relevant insights (e.g., upcoming close dates, at-risk deals, pipeline concentration)
- Format currency values with proper formatting (e.g., $50,000)

IMPORTANT - Deal Stages:
- Deal data contains stage IDs (like "97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5") not human-readable names
- ALWAYS call getPipelines first when you need to report on deal stages
- Use the stageLookup from getPipelines to translate stage IDs to names like "Proposal", "Negotiation", "Closed Won"
- Present stage names to users, never raw IDs

For sentiment analysis:
- Positive: Deal shows strong engagement, buyer enthusiasm, clear path to close, stakeholder alignment
- Neutral: Normal deal progression, no strong signals either way, routine follow-ups
- Negative: Delays, objections, reduced engagement, budget concerns, competitor mentions, stakeholder changes

Always provide actionable insights, not just raw data. When summarizing, highlight what's important for a VP of Revenue Operations.`;

// All available tools for the agent
export const revOpsTools = {
  listOwners: listOwnersTool,
  getOwnerByEmail: getOwnerByEmailTool,
  getDealsByOwner: getDealsByOwnerTool,
  getDealDetails: getDealDetailsTool,
  analyzeDealSentiment: analyzeDealSentimentTool,
  summarizeDeals: summarizeDealsTool,
  getPipelines: getPipelinesTool,
};

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

// Generate a response using the agent (non-streaming)
export async function runAgent(prompt: string, maxSteps = 10) {
  const anthropic = getAnthropicProvider();

  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: REVOPS_AGENT_SYSTEM_PROMPT,
    prompt,
    tools: revOpsTools,
    stopWhen: stepCountIs(maxSteps),
  });

  return {
    text: result.text,
    toolCalls: result.steps.flatMap((step) => step.toolCalls),
    toolResults: result.steps.flatMap((step) => step.toolResults),
    usage: result.usage,
  };
}

// Stream a response using the agent
export function streamAgent(prompt: string, maxSteps = 10) {
  const anthropic = getAnthropicProvider();

  return streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: REVOPS_AGENT_SYSTEM_PROMPT,
    prompt,
    tools: revOpsTools,
    stopWhen: stepCountIs(maxSteps),
  });
}

// Stream with message history (for chat interface)
export function streamAgentWithMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxSteps = 10
) {
  const anthropic = getAnthropicProvider();

  return streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: REVOPS_AGENT_SYSTEM_PROMPT,
    messages,
    tools: revOpsTools,
    stopWhen: stepCountIs(maxSteps),
  });
}
