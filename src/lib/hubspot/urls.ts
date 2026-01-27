// Client-safe HubSpot URL construction (uses NEXT_PUBLIC_ env var)
const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || '7358632';

export function getHubSpotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}/`;
}
