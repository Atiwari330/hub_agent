import { getHubSpotClient } from './client';
import type { HubSpotDeal } from '@/types/hubspot';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

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
