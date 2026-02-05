import { getHubSpotClient } from './client';

// HubSpot property names mapped to our DB columns
const COMPANY_PROPERTIES = [
  'name',
  'domain',
  'hubspot_owner_id',
  // CS Health Properties
  'new_health_score_march_23_2025_3_35_am',         // → health_score
  'new_health_score_march_23_2025_3_35_am_status',  // → health_score_status
  'hs_csm_sentiment',                               // → sentiment
  // Contract Properties
  'cs__contract_end',                               // → contract_end
  'cs__contract_status',                            // → contract_status
  'cs_auto_renew_contract',                         // → auto_renew
  // Revenue Properties
  'cs__arr',                                        // → arr
  'cs__mrr',                                        // → mrr
  'total_revenue',                                  // → total_revenue
  // Activity Properties
  'notes_last_updated',                             // → last_activity_date
  'notes_next_activity_date',                       // → next_activity_date
  'hs_latest_meeting_activity',                     // → latest_meeting_date
];

export interface HubSpotCompany {
  id: string;
  properties: {
    name: string | null;
    domain: string | null;
    hubspot_owner_id: string | null;
    health_score: string | null;
    health_score_status: string | null;
    sentiment: string | null;
    contract_end: string | null;
    contract_status: string | null;
    auto_renew: string | null;
    arr: string | null;
    mrr: string | null;
    total_revenue: string | null;
    last_activity_date: string | null;
    next_activity_date: string | null;
    latest_meeting_date: string | null;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Map raw HubSpot company properties to our normalized interface
 */
function mapCompanyProperties(
  rawProps: Record<string, string | null>
): HubSpotCompany['properties'] {
  return {
    name: rawProps.name || null,
    domain: rawProps.domain || null,
    hubspot_owner_id: rawProps.hubspot_owner_id || null,
    health_score: rawProps['new_health_score_march_23_2025_3_35_am'] || null,
    health_score_status: rawProps['new_health_score_march_23_2025_3_35_am_status'] || null,
    sentiment: rawProps['hs_csm_sentiment'] || null,
    contract_end: rawProps['cs__contract_end'] || null,
    contract_status: rawProps['cs__contract_status'] || null,
    auto_renew: rawProps['cs_auto_renew_contract'] || null,
    arr: rawProps['cs__arr'] || null,
    mrr: rawProps['cs__mrr'] || null,
    total_revenue: rawProps['total_revenue'] || null,
    last_activity_date: rawProps['notes_last_updated'] || null,
    next_activity_date: rawProps['notes_next_activity_date'] || null,
    latest_meeting_date: rawProps['hs_latest_meeting_activity'] || null,
  };
}

/**
 * Fetch all companies that are customers (have contract status set)
 * Uses pagination to handle large datasets
 */
export async function getAllCompanies(): Promise<HubSpotCompany[]> {
  const client = getHubSpotClient();
  const companies: HubSpotCompany[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.companies.basicApi.getPage(
      100, // limit
      after,
      COMPANY_PROPERTIES
    );

    for (const company of response.results) {
      const props = mapCompanyProperties(company.properties as Record<string, string | null>);

      // Only include companies that have contract status or ARR set
      // This filters out leads/prospects and keeps only actual customers
      if (props.contract_status || props.arr) {
        companies.push({
          id: company.id,
          properties: props,
          createdAt: company.createdAt?.toISOString(),
          updatedAt: company.updatedAt?.toISOString(),
        });
      }
    }

    after = response.paging?.next?.after;
  } while (after);

  return companies;
}

/**
 * Fetch companies by a list of IDs
 */
export async function getCompaniesByIds(ids: string[]): Promise<HubSpotCompany[]> {
  if (ids.length === 0) return [];

  const client = getHubSpotClient();
  const companies: HubSpotCompany[] = [];

  // HubSpot batch read has a limit of 100 IDs per request
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const response = await client.crm.companies.batchApi.read({
      properties: COMPANY_PROPERTIES,
      propertiesWithHistory: [],
      inputs: chunk.map((id) => ({ id })),
    });

    for (const company of response.results) {
      const props = mapCompanyProperties(company.properties as Record<string, string | null>);
      companies.push({
        id: company.id,
        properties: props,
        createdAt: company.createdAt?.toISOString(),
        updatedAt: company.updatedAt?.toISOString(),
      });
    }
  }

  return companies;
}

/**
 * Fetch a single company by ID
 */
export async function getCompanyById(companyId: string): Promise<HubSpotCompany | null> {
  const client = getHubSpotClient();

  try {
    const company = await client.crm.companies.basicApi.getById(
      companyId,
      COMPANY_PROPERTIES
    );

    return {
      id: company.id,
      properties: mapCompanyProperties(company.properties as Record<string, string | null>),
      createdAt: company.createdAt?.toISOString(),
      updatedAt: company.updatedAt?.toISOString(),
    };
  } catch {
    return null;
  }
}
