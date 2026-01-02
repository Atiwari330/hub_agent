import { getHubSpotClient } from './client';
import type { HubSpotOwner } from '@/types/hubspot';
import { SYNC_CONFIG } from './sync-config';

export async function listAllOwners(): Promise<HubSpotOwner[]> {
  const client = getHubSpotClient();
  const owners: HubSpotOwner[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.owners.ownersApi.getPage(
      undefined, // email filter
      after,
      500 // limit (max)
    );

    for (const owner of response.results) {
      owners.push({
        id: owner.id,
        email: owner.email || '',
        firstName: owner.firstName,
        lastName: owner.lastName,
        userId: owner.userId,
        createdAt: owner.createdAt?.toISOString(),
        updatedAt: owner.updatedAt?.toISOString(),
        archived: owner.archived,
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return owners;
}

export async function getOwnerByEmail(email: string): Promise<HubSpotOwner | null> {
  const client = getHubSpotClient();

  const response = await client.crm.owners.ownersApi.getPage(
    email, // email filter
    undefined,
    1
  );

  if (response.results.length === 0) {
    return null;
  }

  const owner = response.results[0];
  return {
    id: owner.id,
    email: owner.email || '',
    firstName: owner.firstName,
    lastName: owner.lastName,
    userId: owner.userId,
    createdAt: owner.createdAt?.toISOString(),
    updatedAt: owner.updatedAt?.toISOString(),
    archived: owner.archived,
  };
}

export async function getOwnerById(ownerId: string): Promise<HubSpotOwner | null> {
  const client = getHubSpotClient();

  try {
    const owner = await client.crm.owners.ownersApi.getById(parseInt(ownerId, 10));

    return {
      id: owner.id,
      email: owner.email || '',
      firstName: owner.firstName,
      lastName: owner.lastName,
      userId: owner.userId,
      createdAt: owner.createdAt?.toISOString(),
      updatedAt: owner.updatedAt?.toISOString(),
      archived: owner.archived,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch only the target AE owners configured for sync
 * Uses parallel requests for efficiency (4 API calls instead of paginating all)
 */
export async function getTargetOwners(): Promise<HubSpotOwner[]> {
  const ownerPromises = SYNC_CONFIG.TARGET_AE_EMAILS.map((email) =>
    getOwnerByEmail(email)
  );

  const results = await Promise.all(ownerPromises);

  // Filter out any null results (emails not found in HubSpot)
  return results.filter((owner): owner is HubSpotOwner => owner !== null);
}
