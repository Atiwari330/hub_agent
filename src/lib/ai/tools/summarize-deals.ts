import { tool } from 'ai';
import { z } from 'zod';
import { getDealsByOwnerId } from '@/lib/hubspot/deals';
import { getOwnerByEmail } from '@/lib/hubspot/owners';

export const summarizeDealsTool = tool({
  description: 'Generate a summary of deals for an account executive, including total pipeline value, deal count by stage, and key metrics. Use this for pipeline reviews.',
  inputSchema: z.object({
    ownerEmail: z.string().email().describe('The email address of the account executive'),
  }),
  execute: async ({ ownerEmail }) => {
    const owner = await getOwnerByEmail(ownerEmail);

    if (!owner) {
      return { success: false, message: `No owner found with email: ${ownerEmail}` };
    }

    const deals = await getDealsByOwnerId(owner.id);

    // Calculate metrics
    const totalValue = deals.reduce((sum, d) => {
      return sum + (d.properties.amount ? parseFloat(d.properties.amount) : 0);
    }, 0);

    const byStage = deals.reduce<Record<string, { count: number; value: number }>>((acc, d) => {
      const stage = d.properties.dealstage || 'unknown';
      if (!acc[stage]) {
        acc[stage] = { count: 0, value: 0 };
      }
      acc[stage].count += 1;
      acc[stage].value += d.properties.amount ? parseFloat(d.properties.amount) : 0;
      return acc;
    }, {});

    const now = new Date();
    const upcomingCloses = deals
      .filter((d) => d.properties.closedate)
      .filter((d) => new Date(d.properties.closedate!) > now)
      .sort((a, b) =>
        new Date(a.properties.closedate!).getTime() - new Date(b.properties.closedate!).getTime()
      )
      .slice(0, 5);

    const pastDueDeals = deals
      .filter((d) => d.properties.closedate)
      .filter((d) => new Date(d.properties.closedate!) < now);

    // Find largest deals
    const largestDeals = [...deals]
      .filter((d) => d.properties.amount)
      .sort((a, b) =>
        parseFloat(b.properties.amount!) - parseFloat(a.properties.amount!)
      )
      .slice(0, 5);

    return {
      success: true,
      ownerName: `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email,
      ownerEmail: owner.email,
      summary: {
        totalDeals: deals.length,
        totalPipelineValue: totalValue,
        averageDealSize: deals.length > 0 ? totalValue / deals.length : 0,
        dealsByStage: byStage,
        pastDueCount: pastDueDeals.length,
        upcomingCloses: upcomingCloses.map((d) => ({
          name: d.properties.dealname,
          amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
          closeDate: d.properties.closedate,
          stage: d.properties.dealstage,
        })),
        largestDeals: largestDeals.map((d) => ({
          name: d.properties.dealname,
          amount: parseFloat(d.properties.amount!),
          stage: d.properties.dealstage,
        })),
      },
    };
  },
});
