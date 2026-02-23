import { getHubSpotClient } from './client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/tickets';

const TICKET_PROPERTIES = [
  'subject',
  'source_type',
  'createdate',
  'hs_pipeline',
  'hs_pipeline_stage',
  'hubspot_owner_id',
  'hs_primary_company_name',
  'hs_primary_company_id',
  'hs_is_closed',
  'time_to_close',
  'time_to_first_agent_reply',
  'closed_date',
  'hs_ticket_priority',
  'hs_ticket_category',
  'ball_in_court',
  'support_',
  'support__ticket_type',
  'support__frt_sla_breached',
  'support__flag_nrt_breached',
  'support__linear_task',
];

// Support Pipeline ID in HubSpot
const SUPPORT_PIPELINE_ID = '0';

export interface HubSpotTicket {
  id: string;
  properties: {
    subject: string | null;
    source_type: string | null;
    createdate: string | null;
    hs_pipeline: string | null;
    hs_pipeline_stage: string | null;
    hubspot_owner_id: string | null;
    hs_primary_company_name: string | null;
    hs_primary_company_id: string | null;
    hs_is_closed: string | null;
    time_to_close: string | null;
    time_to_first_agent_reply: string | null;
    closed_date: string | null;
    hs_ticket_priority: string | null;
    hs_ticket_category: string | null;
    ball_in_court: string | null;
    software: string | null;
    ticket_type: string | null;
    frt_sla_breached: string | null;
    nrt_sla_breached: string | null;
    linear_task: string | null;
  };
}

function mapTicketProperties(
  rawProps: Record<string, string | null>
): HubSpotTicket['properties'] {
  return {
    subject: rawProps.subject || null,
    source_type: rawProps.source_type || null,
    createdate: rawProps.createdate || null,
    hs_pipeline: rawProps.hs_pipeline || null,
    hs_pipeline_stage: rawProps.hs_pipeline_stage || null,
    hubspot_owner_id: rawProps.hubspot_owner_id || null,
    hs_primary_company_name: rawProps.hs_primary_company_name || null,
    hs_primary_company_id: rawProps.hs_primary_company_id || null,
    hs_is_closed: rawProps.hs_is_closed || null,
    time_to_close: rawProps.time_to_close || null,
    time_to_first_agent_reply: rawProps.time_to_first_agent_reply || null,
    closed_date: rawProps.closed_date || null,
    hs_ticket_priority: rawProps.hs_ticket_priority || null,
    hs_ticket_category: rawProps.hs_ticket_category || null,
    ball_in_court: rawProps.ball_in_court || null,
    software: rawProps['support_'] || null,
    ticket_type: rawProps['support__ticket_type'] || null,
    frt_sla_breached: rawProps['support__frt_sla_breached'] || null,
    nrt_sla_breached: rawProps['support__flag_nrt_breached'] || null,
    linear_task: rawProps['support__linear_task'] || null,
  };
}

/**
 * Fetch all open tickets in the Support Pipeline
 */
export async function getOpenTickets(): Promise<HubSpotTicket[]> {
  const client = getHubSpotClient();
  const tickets: HubSpotTicket[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.tickets.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hs_pipeline',
              operator: FilterOperatorEnum.Eq,
              value: SUPPORT_PIPELINE_ID,
            },
            {
              propertyName: 'hs_is_closed',
              operator: FilterOperatorEnum.Eq,
              value: 'false',
            },
          ],
        },
      ],
      properties: TICKET_PROPERTIES,
      limit: 100,
      after: after ? after : undefined,
    });

    for (const ticket of response.results) {
      tickets.push({
        id: ticket.id,
        properties: mapTicketProperties(
          ticket.properties as Record<string, string | null>
        ),
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return tickets;
}

/**
 * Fetch recently closed tickets (last 90 days) in the Support Pipeline
 */
export async function getRecentlyClosedTickets(): Promise<HubSpotTicket[]> {
  const client = getHubSpotClient();
  const tickets: HubSpotTicket[] = [];
  let after: string | undefined;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const ninetyDaysAgoMs = ninetyDaysAgo.getTime().toString();

  do {
    const response = await client.crm.tickets.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hs_pipeline',
              operator: FilterOperatorEnum.Eq,
              value: SUPPORT_PIPELINE_ID,
            },
            {
              propertyName: 'hs_is_closed',
              operator: FilterOperatorEnum.Eq,
              value: 'true',
            },
            {
              propertyName: 'closed_date',
              operator: FilterOperatorEnum.Gte,
              value: ninetyDaysAgoMs,
            },
          ],
        },
      ],
      properties: TICKET_PROPERTIES,
      limit: 100,
      after: after ? after : undefined,
    });

    for (const ticket of response.results) {
      tickets.push({
        id: ticket.id,
        properties: mapTicketProperties(
          ticket.properties as Record<string, string | null>
        ),
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return tickets;
}
