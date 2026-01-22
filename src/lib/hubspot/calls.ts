/**
 * HubSpot Calls API Wrapper
 *
 * Fetches call engagements from HubSpot with filtering by owner and date range.
 */

import { getHubSpotClient } from './client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/calls';
import type { CallData, CallContact, CallDeal } from '@/types/calls';

// HubSpot portal ID for URL construction
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || '7358632';

/**
 * Construct HubSpot URLs for various object types
 */
export function getHubSpotCallUrl(callId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-48/${callId}/`;
}

export function getHubSpotContactUrl(contactId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}/`;
}

export function getHubSpotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}/`;
}

/**
 * Fetch calls for a specific owner within a date range
 */
export async function fetchCallsByOwner(
  hubspotOwnerId: string,
  startDate: Date,
  endDate: Date
): Promise<CallData[]> {
  const client = getHubSpotClient();
  const calls: CallData[] = [];
  let after: string | undefined;

  const startTimestamp = startDate.getTime().toString();
  const endTimestamp = endDate.getTime().toString();

  do {
    try {
      const response = await client.crm.objects.calls.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: hubspotOwnerId,
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Gte,
                value: startTimestamp,
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Lte,
                value: endTimestamp,
              },
            ],
          },
        ],
        properties: [
          'hs_timestamp',
          'hs_call_duration',
          'hs_call_status',
          'hs_call_disposition',
          'hs_call_title',
          'hs_call_body',
          'hubspot_owner_id',
        ],
        limit: 100,
        after: after ? after : undefined,
      });

      for (const call of response.results) {
        calls.push({
          id: call.id,
          timestamp: call.properties.hs_timestamp
            ? new Date(call.properties.hs_timestamp)
            : new Date(),
          title: call.properties.hs_call_title || null,
          durationMs: call.properties.hs_call_duration
            ? parseInt(call.properties.hs_call_duration, 10)
            : null,
          status: call.properties.hs_call_status || null,
          outcomeId: call.properties.hs_call_disposition || null,
          body: call.properties.hs_call_body || null,
        });
      }

      after = response.paging?.next?.after;
    } catch (error) {
      console.error('Error searching calls:', error);
      break;
    }
  } while (after);

  return calls;
}

/**
 * Fetch all calls for an owner (no date filter, useful for debugging)
 */
export async function fetchAllCallsByOwner(
  hubspotOwnerId: string,
  limit: number = 100
): Promise<CallData[]> {
  const client = getHubSpotClient();

  try {
    const response = await client.crm.objects.calls.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hubspot_owner_id',
              operator: FilterOperatorEnum.Eq,
              value: hubspotOwnerId,
            },
          ],
        },
      ],
      properties: [
        'hs_timestamp',
        'hs_call_duration',
        'hs_call_status',
        'hs_call_disposition',
        'hs_call_title',
        'hs_call_body',
        'hubspot_owner_id',
      ],
      limit,
    });

    return response.results.map((call) => ({
      id: call.id,
      timestamp: call.properties.hs_timestamp
        ? new Date(call.properties.hs_timestamp)
        : new Date(),
      title: call.properties.hs_call_title || null,
      durationMs: call.properties.hs_call_duration
        ? parseInt(call.properties.hs_call_duration, 10)
        : null,
      status: call.properties.hs_call_status || null,
      outcomeId: call.properties.hs_call_disposition || null,
      body: call.properties.hs_call_body || null,
    }));
  } catch (error) {
    console.error('Error fetching all calls:', error);
    return [];
  }
}

/**
 * Fetch associations (contacts and deals) for a batch of call IDs
 */
export async function fetchCallAssociations(
  callIds: string[]
): Promise<Map<string, { contacts: CallContact[]; deals: CallDeal[] }>> {
  const client = getHubSpotClient();
  const result = new Map<string, { contacts: CallContact[]; deals: CallDeal[] }>();

  // Initialize empty arrays for all call IDs
  for (const id of callIds) {
    result.set(id, { contacts: [], deals: [] });
  }

  if (callIds.length === 0) return result;

  try {
    // Batch fetch associations for contacts
    const contactAssociations = await client.crm.associations.batchApi.read(
      'calls',
      'contacts',
      { inputs: callIds.map((id) => ({ id })) }
    );

    // Collect all contact IDs to fetch
    const contactIds = new Set<string>();
    const callContactMap = new Map<string, string[]>();

    for (const assoc of contactAssociations.results) {
      const callId = assoc._from.id;
      const associatedContactIds = assoc.to.map((t) => t.id);
      callContactMap.set(callId, associatedContactIds);
      for (const cid of associatedContactIds) {
        contactIds.add(cid);
      }
    }

    // Fetch contact details if we have any
    const contactDetails = new Map<string, { name: string | null; email: string | null }>();
    if (contactIds.size > 0) {
      const contactBatch = await client.crm.contacts.batchApi.read({
        inputs: Array.from(contactIds).map((id) => ({ id })),
        properties: ['firstname', 'lastname', 'email'],
        propertiesWithHistory: [],
      });

      for (const contact of contactBatch.results) {
        const firstName = contact.properties.firstname || '';
        const lastName = contact.properties.lastname || '';
        const name = [firstName, lastName].filter(Boolean).join(' ') || null;
        contactDetails.set(contact.id, {
          name,
          email: contact.properties.email || null,
        });
      }
    }

    // Build contact data for each call
    for (const [callId, associatedContactIds] of callContactMap) {
      const existing = result.get(callId);
      if (existing) {
        existing.contacts = associatedContactIds.map((cid) => {
          const details = contactDetails.get(cid);
          return {
            id: cid,
            name: details?.name || null,
            email: details?.email || null,
            hubspotUrl: getHubSpotContactUrl(cid),
          };
        });
      }
    }

    // Batch fetch associations for deals
    const dealAssociations = await client.crm.associations.batchApi.read(
      'calls',
      'deals',
      { inputs: callIds.map((id) => ({ id })) }
    );

    // Collect all deal IDs to fetch
    const dealIds = new Set<string>();
    const callDealMap = new Map<string, string[]>();

    for (const assoc of dealAssociations.results) {
      const callId = assoc._from.id;
      const associatedDealIds = assoc.to.map((t) => t.id);
      callDealMap.set(callId, associatedDealIds);
      for (const did of associatedDealIds) {
        dealIds.add(did);
      }
    }

    // Fetch deal details if we have any
    const dealDetails = new Map<string, { name: string; amount: number | null }>();
    if (dealIds.size > 0) {
      const dealBatch = await client.crm.deals.batchApi.read({
        inputs: Array.from(dealIds).map((id) => ({ id })),
        properties: ['dealname', 'amount'],
        propertiesWithHistory: [],
      });

      for (const deal of dealBatch.results) {
        dealDetails.set(deal.id, {
          name: deal.properties.dealname || 'Unnamed Deal',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
        });
      }
    }

    // Build deal data for each call
    for (const [callId, associatedDealIds] of callDealMap) {
      const existing = result.get(callId);
      if (existing) {
        existing.deals = associatedDealIds.map((did) => {
          const details = dealDetails.get(did);
          return {
            id: did,
            name: details?.name || 'Unnamed Deal',
            amount: details?.amount || null,
            hubspotUrl: getHubSpotDealUrl(did),
          };
        });
      }
    }
  } catch (error) {
    console.error('Error fetching call associations:', error);
    // Return the map with empty associations on error
  }

  return result;
}
