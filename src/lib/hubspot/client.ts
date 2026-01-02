import { Client } from '@hubspot/api-client';

let hubspotClient: Client | null = null;

export function getHubSpotClient(): Client {
  if (!hubspotClient) {
    const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
    }

    hubspotClient = new Client({
      accessToken,
      numberOfApiCallRetries: 3,
    });
  }

  return hubspotClient;
}

// Reset client (useful for testing)
export function resetHubSpotClient(): void {
  hubspotClient = null;
}
