import { tool } from 'ai';
import { z } from 'zod';
import { listAllOwners, getOwnerByEmail } from '@/lib/hubspot/owners';

export const listOwnersTool = tool({
  description: 'List all account executives (owners) in HubSpot. Use this to find AEs by name or see all available AEs.',
  inputSchema: z.object({
    nameFilter: z.string().optional().describe('Optional: Filter owners by first or last name (case-insensitive partial match)'),
  }),
  execute: async ({ nameFilter }) => {
    const owners = await listAllOwners();

    let filtered = owners;
    if (nameFilter) {
      const lowerFilter = nameFilter.toLowerCase();
      filtered = owners.filter((o) =>
        o.firstName?.toLowerCase().includes(lowerFilter) ||
        o.lastName?.toLowerCase().includes(lowerFilter) ||
        o.email.toLowerCase().includes(lowerFilter)
      );
    }

    return {
      count: filtered.length,
      owners: filtered.map((o) => ({
        id: o.id,
        name: `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email,
        email: o.email,
      })),
    };
  },
});

export const getOwnerByEmailTool = tool({
  description: 'Get a specific account executive by their email address. Use this when you know the AE\'s email.',
  inputSchema: z.object({
    email: z.string().email().describe('The email address of the account executive'),
  }),
  execute: async ({ email }) => {
    const owner = await getOwnerByEmail(email);

    if (!owner) {
      return { found: false, message: `No owner found with email: ${email}` };
    }

    return {
      found: true,
      owner: {
        id: owner.id,
        name: `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email,
        email: owner.email,
      },
    };
  },
});
