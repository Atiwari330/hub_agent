import { tool } from 'ai';
import { z } from 'zod';
import { getDealById } from '@/lib/hubspot/deals';
import { getNotesByDealId } from '@/lib/hubspot/engagements';

export const analyzeDealSentimentTool = tool({
  description: 'Analyze the sentiment of a deal based on its notes and activity. Gathers all text content from the deal for sentiment analysis. Use this to understand deal health.',
  inputSchema: z.object({
    dealId: z.string().describe('The HubSpot deal ID to analyze'),
  }),
  execute: async ({ dealId }) => {
    const deal = await getDealById(dealId);

    if (!deal) {
      return { success: false, message: `No deal found with ID: ${dealId}` };
    }

    const notes = await getNotesByDealId(dealId);

    // Compile all text content for sentiment analysis
    const textContent: string[] = [];

    if (deal.properties.description) {
      textContent.push(`Deal Description: ${deal.properties.description}`);
    }

    for (const note of notes) {
      if (note.properties.hs_note_body) {
        textContent.push(`Note: ${note.properties.hs_note_body}`);
      }
    }

    if (textContent.length === 0) {
      return {
        success: true,
        dealId,
        dealName: deal.properties.dealname,
        sentiment: 'neutral' as const,
        confidence: 0.3,
        reasoning: 'No notes or description available for sentiment analysis. Defaulting to neutral.',
        textAnalyzed: 0,
      };
    }

    // Return the text content for the LLM to analyze
    // The LLM will use this output to determine sentiment
    return {
      success: true,
      dealId,
      dealName: deal.properties.dealname,
      dealStage: deal.properties.dealstage,
      closeDate: deal.properties.closedate,
      textForAnalysis: textContent.join('\n\n'),
      noteCount: notes.length,
      instruction: 'Based on the above text, determine the overall sentiment (positive, neutral, or negative) with confidence level (0-1) and provide reasoning. Consider: buyer engagement, objections mentioned, timeline concerns, budget discussions, and competitive mentions.',
    };
  },
});
