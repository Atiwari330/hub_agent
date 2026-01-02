import { getHubSpotClient } from './client';
import type { HubSpotOwner } from '@/types/hubspot';

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
