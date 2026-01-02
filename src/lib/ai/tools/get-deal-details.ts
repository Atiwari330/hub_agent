import { tool } from 'ai';
import { z } from 'zod';
import { getDealById } from '@/lib/hubspot/deals';
import { getNotesByDealId } from '@/lib/hubspot/engagements';

export const getDealDetailsTool = tool({
  description: 'Get detailed information about a specific deal, including its notes and activity history. Use this for deep analysis of a single deal.',
  inputSchema: z.object({
    dealId: z.string().describe('The HubSpot deal ID'),
    includeNotes: z.boolean().default(true).describe('Whether to include associated notes'),
  }),
  execute: async ({ dealId, includeNotes }) => {
    const deal = await getDealById(dealId);

    if (!deal) {
      return { found: false, message: `No deal found with ID: ${dealId}` };
    }

    let notes: Array<{ id: string; body: string | null | undefined; timestamp: string | null | undefined }> = [];
    if (includeNotes) {
      const rawNotes = await getNotesByDealId(dealId);
      notes = rawNotes.map((n) => ({
        id: n.id,
        body: n.properties.hs_note_body,
        timestamp: n.properties.hs_timestamp,
      }));
    }

    return {
      found: true,
      deal: {
        id: deal.id,
        name: deal.properties.dealname,
        amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
        stage: deal.properties.dealstage,
        pipeline: deal.properties.pipeline,
        closeDate: deal.properties.closedate,
        description: deal.properties.description,
        lastModified: deal.properties.hs_lastmodifieddate,
      },
      notes,
      noteCount: notes.length,
    };
  },
});
