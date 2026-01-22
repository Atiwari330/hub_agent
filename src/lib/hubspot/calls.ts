/**
 * HubSpot Calls API Wrapper
 *
 * Fetches call engagements from HubSpot with filtering by owner and date range.
 */

import { getHubSpotClient } from './client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/calls';
import type { CallData } from '@/types/calls';

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
