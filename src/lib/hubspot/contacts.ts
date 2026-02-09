/**
 * HubSpot Contacts API Wrapper
 *
 * Fetches prospect contact counts from HubSpot for the AE portal SPIFF tracking.
 * Prospects are contacts created by an AE with specific lead sources and valid phone numbers.
 */

import { getHubSpotClient } from './client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts';

// Lead sources that count as "prospecting" activity
const PROSPECT_LEAD_SOURCES = ['Event', 'List', 'Prospecting'];

// Statuses that disqualify a contact from being counted
const EXCLUDED_STATUSES = ['Bad Contact Info', 'Duplicate', 'Spam'];

/**
 * Fetch the count of prospect contacts created by a specific owner within a date range.
 *
 * Filters (matching CMO dashboard criteria):
 * 1. createdate >= startDate AND <= endDate
 * 2. hs_lead_status NOT IN ('Bad Contact Info', 'Duplicate', 'Spam')
 * 3. lead_source IN ('Event', 'List', 'Prospecting')
 * 4. phone IS KNOWN (not empty)
 * 5. hubspot_owner_id = the AE's owner ID
 */
export async function fetchProspectCountByOwner(
  hubspotOwnerId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const client = getHubSpotClient();
  let total = 0;
  let after: string | undefined;

  const startTimestamp = startDate.getTime().toString();
  const endTimestamp = endDate.getTime().toString();

  // HubSpot search API limits to 3 filters per filterGroup and max 5 filterGroups.
  // We need to use multiple filterGroups to handle the NOT_IN + lead source combinations.
  // Strategy: One filterGroup per lead source, each including the common filters.
  // For hs_lead_status NOT_IN, we use NEQ filters (one per excluded status) but
  // HubSpot only allows up to ~6 filters per group. We'll combine them.

  // Build filter groups - one per lead source, each with all common filters
  const filterGroups = PROSPECT_LEAD_SOURCES.map((source) => ({
    filters: [
      {
        propertyName: 'hubspot_owner_id',
        operator: FilterOperatorEnum.Eq,
        value: hubspotOwnerId,
      },
      {
        propertyName: 'createdate',
        operator: FilterOperatorEnum.Gte,
        value: startTimestamp,
      },
      {
        propertyName: 'createdate',
        operator: FilterOperatorEnum.Lte,
        value: endTimestamp,
      },
      {
        propertyName: 'phone',
        operator: FilterOperatorEnum.HasProperty,
      },
      {
        propertyName: 'lead_source__sync_',
        operator: FilterOperatorEnum.Eq,
        value: source,
      },
    ],
  }));

  do {
    try {
      const response = await client.crm.contacts.searchApi.doSearch({
        filterGroups,
        properties: ['createdate'],
        limit: 100,
        after: after ? after : undefined,
      });

      total += response.results.length;
      after = response.paging?.next?.after;
    } catch (error) {
      console.error('Error searching prospect contacts:', error);
      break;
    }
  } while (after);

  // Post-filter: exclude contacts with bad statuses
  // Since we can't combine NOT_IN with the other filters in HubSpot's search API
  // within the same filterGroup (OR logic between groups), we fetch all and then
  // subtract the excluded ones.
  // Actually, the filterGroups above use OR between groups but AND within each group.
  // This gives us contacts matching ANY of the lead sources (correct).
  // But we can't add NOT_IN for hs_lead_status within filterGroups (it would be per-group).
  // Let's do a second query to count excluded ones and subtract.

  let excludedCount = 0;
  after = undefined;

  const excludedFilterGroups = PROSPECT_LEAD_SOURCES.flatMap((source) =>
    EXCLUDED_STATUSES.map((status) => ({
      filters: [
        {
          propertyName: 'hubspot_owner_id',
          operator: FilterOperatorEnum.Eq,
          value: hubspotOwnerId,
        },
        {
          propertyName: 'createdate',
          operator: FilterOperatorEnum.Gte,
          value: startTimestamp,
        },
        {
          propertyName: 'createdate',
          operator: FilterOperatorEnum.Lte,
          value: endTimestamp,
        },
        {
          propertyName: 'phone',
          operator: FilterOperatorEnum.HasProperty,
        },
        {
          propertyName: 'lead_source__sync_',
          operator: FilterOperatorEnum.Eq,
          value: source,
        },
        {
          propertyName: 'hs_lead_status',
          operator: FilterOperatorEnum.Eq,
          value: status,
        },
      ],
    }))
  );

  // Only run excluded query if we have results and the filter groups fit
  // HubSpot allows max 5 filterGroups per search - we have 9 (3 sources x 3 statuses)
  // We need to batch these
  if (total > 0) {
    for (let i = 0; i < excludedFilterGroups.length; i += 5) {
      const batch = excludedFilterGroups.slice(i, i + 5);
      after = undefined;

      do {
        try {
          const response = await client.crm.contacts.searchApi.doSearch({
            filterGroups: batch,
            properties: ['createdate'],
            limit: 100,
            after: after ? after : undefined,
          });

          excludedCount += response.results.length;
          after = response.paging?.next?.after;
        } catch (error) {
          console.error('Error searching excluded contacts:', error);
          break;
        }
      } while (after);
    }
  }

  return Math.max(0, total - excludedCount);
}
