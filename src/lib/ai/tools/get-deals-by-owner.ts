import { tool } from 'ai';
import { z } from 'zod';
import { getDealsByOwnerId } from '@/lib/hubspot/deals';
import { getOwnerByEmail } from '@/lib/hubspot/owners';

export const getDealsByOwnerTool = tool({
  description: 'Get all deals owned by a specific account executive. You can provide either the owner ID or email. Returns deal names, amounts, stages, and close dates.',
  inputSchema: z.object({
    ownerEmail: z.string().email().optional().describe('The email address of the owner'),
    ownerId: z.string().optional().describe('The HubSpot owner ID (if known)'),
  }),
  execute: async ({ ownerEmail, ownerId }) => {
    let resolvedOwnerId = ownerId;
    let ownerName = '';

    // If email provided but no ID, look up the owner
    if (ownerEmail && !ownerId) {
      const owner = await getOwnerByEmail(ownerEmail);
      if (!owner) {
        return { found: false, message: `No owner found with email: ${ownerEmail}` };
      }
      resolvedOwnerId = owner.id;
      ownerName = `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email;
    }

    if (!resolvedOwnerId) {
      return { error: 'Must provide either ownerEmail or ownerId' };
    }

    const deals = await getDealsByOwnerId(resolvedOwnerId);

    // Calculate summary stats
    const totalValue = deals.reduce((sum, d) => {
      return sum + (d.properties.amount ? parseFloat(d.properties.amount) : 0);
    }, 0);

    return {
      ownerId: resolvedOwnerId,
      ownerName: ownerName || undefined,
      dealCount: deals.length,
      totalPipelineValue: totalValue,
      deals: deals.map((d) => ({
        id: d.id,
        name: d.properties.dealname,
        amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
        stage: d.properties.dealstage,
        pipeline: d.properties.pipeline,
        closeDate: d.properties.closedate,
      })),
    };
  },
});
