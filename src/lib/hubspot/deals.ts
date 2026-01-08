import { getHubSpotClient } from './client';
import type { HubSpotDeal } from '@/types/hubspot';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';
import { getStageEntryProperties, TRACKED_STAGES } from './stage-mappings';
import { SYNC_CONFIG } from './sync-config';

const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'closedate',
  'pipeline',
  'dealstage',
  'hubspot_owner_id',
  'createdate',
  'hs_lastmodifieddate',
  'description',
  'notes_last_updated',
  // New properties for dashboard display
  'lead_source',
  'notes_next_activity_date',
  'hs_next_step',
  'product_s',
  'proposal_stage',
  // Deal collaborator for hygiene tracking
  'hs_all_collaborator_owner_ids',
  // Stage entry timestamps for weekly pipeline tracking
  ...getStageEntryProperties(),
];

export async function getDealsByOwnerId(ownerId: string): Promise<HubSpotDeal[]> {
  const client = getHubSpotClient();
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hubspot_owner_id',
              operator: FilterOperatorEnum.Eq,
              value: ownerId,
            },
          ],
        },
      ],
      properties: DEAL_PROPERTIES,
      limit: 100,
      after: after ? after : undefined,
    });

    for (const deal of response.results) {
      deals.push({
        id: deal.id,
        properties: {
          dealname: deal.properties.dealname || '',
          amount: deal.properties.amount,
          closedate: deal.properties.closedate,
          pipeline: deal.properties.pipeline,
          dealstage: deal.properties.dealstage,
          hubspot_owner_id: deal.properties.hubspot_owner_id,
          createdate: deal.properties.createdate,
          hs_lastmodifieddate: deal.properties.hs_lastmodifieddate,
          description: deal.properties.description,
          notes_last_updated: deal.properties.notes_last_updated,
          lead_source: deal.properties.lead_source,
          notes_next_activity_date: deal.properties.notes_next_activity_date,
          hs_next_step: deal.properties.hs_next_step,
          product_s: deal.properties.product_s,
          proposal_stage: deal.properties.proposal_stage,
          hs_all_collaborator_owner_ids: deal.properties.hs_all_collaborator_owner_ids,
          // Stage entry timestamps
          [TRACKED_STAGES.SQL.property]: deal.properties[TRACKED_STAGES.SQL.property],
          [TRACKED_STAGES.DEMO_SCHEDULED.property]: deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property],
          [TRACKED_STAGES.DEMO_COMPLETED.property]: deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property],
          [TRACKED_STAGES.CLOSED_WON.property]: deal.properties[TRACKED_STAGES.CLOSED_WON.property],
        },
        createdAt: deal.createdAt?.toISOString(),
        updatedAt: deal.updatedAt?.toISOString(),
        archived: deal.archived,
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return deals;
}

export async function getDealById(dealId: string): Promise<HubSpotDeal | null> {
  const client = getHubSpotClient();

  try {
    const deal = await client.crm.deals.basicApi.getById(
      dealId,
      DEAL_PROPERTIES
    );

    return {
      id: deal.id,
      properties: {
        dealname: deal.properties.dealname || '',
        amount: deal.properties.amount,
        closedate: deal.properties.closedate,
        pipeline: deal.properties.pipeline,
        dealstage: deal.properties.dealstage,
        hubspot_owner_id: deal.properties.hubspot_owner_id,
        createdate: deal.properties.createdate,
        hs_lastmodifieddate: deal.properties.hs_lastmodifieddate,
        description: deal.properties.description,
        notes_last_updated: deal.properties.notes_last_updated,
        lead_source: deal.properties.lead_source,
        notes_next_activity_date: deal.properties.notes_next_activity_date,
        hs_next_step: deal.properties.hs_next_step,
        product_s: deal.properties.product_s,
        proposal_stage: deal.properties.proposal_stage,
        hs_all_collaborator_owner_ids: deal.properties.hs_all_collaborator_owner_ids,
        // Stage entry timestamps
        [TRACKED_STAGES.SQL.property]: deal.properties[TRACKED_STAGES.SQL.property],
        [TRACKED_STAGES.DEMO_SCHEDULED.property]: deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property],
        [TRACKED_STAGES.DEMO_COMPLETED.property]: deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property],
        [TRACKED_STAGES.CLOSED_WON.property]: deal.properties[TRACKED_STAGES.CLOSED_WON.property],
      },
      createdAt: deal.createdAt?.toISOString(),
      updatedAt: deal.updatedAt?.toISOString(),
      archived: deal.archived,
    };
  } catch {
    return null;
  }
}

export async function getAllDeals(): Promise<HubSpotDeal[]> {
  const client = getHubSpotClient();
  const deals: HubSpotDeal[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.deals.basicApi.getPage(
      100, // limit
      after,
      DEAL_PROPERTIES
    );

    for (const deal of response.results) {
      deals.push({
        id: deal.id,
        properties: {
          dealname: deal.properties.dealname || '',
          amount: deal.properties.amount,
          closedate: deal.properties.closedate,
          pipeline: deal.properties.pipeline,
          dealstage: deal.properties.dealstage,
          hubspot_owner_id: deal.properties.hubspot_owner_id,
          createdate: deal.properties.createdate,
          hs_lastmodifieddate: deal.properties.hs_lastmodifieddate,
          description: deal.properties.description,
          notes_last_updated: deal.properties.notes_last_updated,
          lead_source: deal.properties.lead_source,
          notes_next_activity_date: deal.properties.notes_next_activity_date,
          hs_next_step: deal.properties.hs_next_step,
          product_s: deal.properties.product_s,
          proposal_stage: deal.properties.proposal_stage,
          hs_all_collaborator_owner_ids: deal.properties.hs_all_collaborator_owner_ids,
          // Stage entry timestamps
          [TRACKED_STAGES.SQL.property]: deal.properties[TRACKED_STAGES.SQL.property],
          [TRACKED_STAGES.DEMO_SCHEDULED.property]: deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property],
          [TRACKED_STAGES.DEMO_COMPLETED.property]: deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property],
          [TRACKED_STAGES.CLOSED_WON.property]: deal.properties[TRACKED_STAGES.CLOSED_WON.property],
        },
        createdAt: deal.createdAt?.toISOString(),
        updatedAt: deal.updatedAt?.toISOString(),
        archived: deal.archived,
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return deals;
}

/**
 * Fetch deals for sync job with filters:
 * - Only specified owner IDs
 * - Only Sales Pipeline
 * - Only deals with createdate >= MIN_DATE OR closedate >= MIN_DATE
 */
export async function getFilteredDealsForSync(
  ownerIds: string[]
): Promise<HubSpotDeal[]> {
  const client = getHubSpotClient();
  const allDeals: HubSpotDeal[] = [];

  // Process each owner to stay within HubSpot filter limits
  for (const ownerId of ownerIds) {
    let after: string | undefined;

    do {
      const response = await client.crm.deals.searchApi.doSearch({
        // Filter groups are OR-ed together
        filterGroups: [
          // Group 1: Owner + Pipeline + createdate >= MIN_DATE
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
              {
                propertyName: 'pipeline',
                operator: FilterOperatorEnum.Eq,
                value: SYNC_CONFIG.TARGET_PIPELINE_ID,
              },
              {
                propertyName: 'createdate',
                operator: FilterOperatorEnum.Gte,
                value: SYNC_CONFIG.MIN_DATE,
              },
            ],
          },
          // Group 2: Owner + Pipeline + closedate >= MIN_DATE
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
              {
                propertyName: 'pipeline',
                operator: FilterOperatorEnum.Eq,
                value: SYNC_CONFIG.TARGET_PIPELINE_ID,
              },
              {
                propertyName: 'closedate',
                operator: FilterOperatorEnum.Gte,
                value: SYNC_CONFIG.MIN_DATE,
              },
            ],
          },
        ],
        properties: DEAL_PROPERTIES,
        limit: 100,
        after: after ? after : undefined,
      });

      for (const deal of response.results) {
        allDeals.push({
          id: deal.id,
          properties: {
            dealname: deal.properties.dealname || '',
            amount: deal.properties.amount,
            closedate: deal.properties.closedate,
            pipeline: deal.properties.pipeline,
            dealstage: deal.properties.dealstage,
            hubspot_owner_id: deal.properties.hubspot_owner_id,
            createdate: deal.properties.createdate,
            hs_lastmodifieddate: deal.properties.hs_lastmodifieddate,
            description: deal.properties.description,
            notes_last_updated: deal.properties.notes_last_updated,
            lead_source: deal.properties.lead_source,
            notes_next_activity_date: deal.properties.notes_next_activity_date,
            hs_next_step: deal.properties.hs_next_step,
            product_s: deal.properties.product_s,
            proposal_stage: deal.properties.proposal_stage,
            hs_all_collaborator_owner_ids: deal.properties.hs_all_collaborator_owner_ids,
            [TRACKED_STAGES.SQL.property]:
              deal.properties[TRACKED_STAGES.SQL.property],
            [TRACKED_STAGES.DEMO_SCHEDULED.property]:
              deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property],
            [TRACKED_STAGES.DEMO_COMPLETED.property]:
              deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property],
            [TRACKED_STAGES.CLOSED_WON.property]:
              deal.properties[TRACKED_STAGES.CLOSED_WON.property],
          },
          createdAt: deal.createdAt?.toISOString(),
          updatedAt: deal.updatedAt?.toISOString(),
          archived: deal.archived,
        });
      }

      after = response.paging?.next?.after;
    } while (after);
  }

  // Deduplicate deals (a deal might match both date conditions)
  const uniqueDeals = new Map<string, HubSpotDeal>();
  for (const deal of allDeals) {
    uniqueDeals.set(deal.id, deal);
  }

  return Array.from(uniqueDeals.values());
}

/**
 * Result of fetching a deal with next step history
 */
export interface DealWithNextStepHistory {
  deal: HubSpotDeal;
  nextStepValue: string | null;
  nextStepUpdatedAt: string | null;
}

/**
 * Fetch a deal with property history for hs_next_step
 * Returns the current next step value and when it was last updated
 */
export async function getDealWithNextStepHistory(
  dealId: string
): Promise<DealWithNextStepHistory | null> {
  const client = getHubSpotClient();

  try {
    // Use the basicApi.getById with propertiesWithHistory parameter
    const deal = await client.crm.deals.basicApi.getById(
      dealId,
      DEAL_PROPERTIES,
      ['hs_next_step'], // propertiesWithHistory
      undefined, // associations
      false // archived
    );

    // Extract the next step value
    const nextStepValue = deal.properties.hs_next_step || null;

    // Extract the history for hs_next_step
    // The propertiesWithHistory response includes a 'propertiesWithHistory' field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dealWithHistory = deal as any;
    let nextStepUpdatedAt: string | null = null;

    if (
      dealWithHistory.propertiesWithHistory &&
      dealWithHistory.propertiesWithHistory.hs_next_step &&
      Array.isArray(dealWithHistory.propertiesWithHistory.hs_next_step) &&
      dealWithHistory.propertiesWithHistory.hs_next_step.length > 0
    ) {
      // History is in reverse chronological order, first item is most recent
      const mostRecent = dealWithHistory.propertiesWithHistory.hs_next_step[0];
      if (mostRecent.timestamp) {
        nextStepUpdatedAt = mostRecent.timestamp;
      }
    }

    const hubspotDeal: HubSpotDeal = {
      id: deal.id,
      properties: {
        dealname: deal.properties.dealname || '',
        amount: deal.properties.amount,
        closedate: deal.properties.closedate,
        pipeline: deal.properties.pipeline,
        dealstage: deal.properties.dealstage,
        hubspot_owner_id: deal.properties.hubspot_owner_id,
        createdate: deal.properties.createdate,
        hs_lastmodifieddate: deal.properties.hs_lastmodifieddate,
        description: deal.properties.description,
        notes_last_updated: deal.properties.notes_last_updated,
        lead_source: deal.properties.lead_source,
        notes_next_activity_date: deal.properties.notes_next_activity_date,
        hs_next_step: deal.properties.hs_next_step,
        product_s: deal.properties.product_s,
        proposal_stage: deal.properties.proposal_stage,
        hs_all_collaborator_owner_ids: deal.properties.hs_all_collaborator_owner_ids,
        [TRACKED_STAGES.SQL.property]: deal.properties[TRACKED_STAGES.SQL.property],
        [TRACKED_STAGES.DEMO_SCHEDULED.property]:
          deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property],
        [TRACKED_STAGES.DEMO_COMPLETED.property]:
          deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property],
        [TRACKED_STAGES.CLOSED_WON.property]:
          deal.properties[TRACKED_STAGES.CLOSED_WON.property],
      },
      createdAt: deal.createdAt?.toISOString(),
      updatedAt: deal.updatedAt?.toISOString(),
      archived: deal.archived,
    };

    return {
      deal: hubspotDeal,
      nextStepValue,
      nextStepUpdatedAt,
    };
  } catch (error) {
    console.error('Error fetching deal with next step history:', error);
    return null;
  }
}
