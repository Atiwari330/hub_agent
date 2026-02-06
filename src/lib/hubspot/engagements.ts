import { getHubSpotClient } from './client';
import type { HubSpotNote } from '@/types/hubspot';
import type { HubSpotNoteWithAuthor } from '@/types/exception-context';

export async function getNotesByDealId(dealId: string): Promise<HubSpotNote[]> {
  const client = getHubSpotClient();
  const notes: HubSpotNote[] = [];

  try {
    // Get associations using v4 API: deals -> notes
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'notes',
      undefined,
      100
    );

    if (associations.results.length === 0) {
      return notes;
    }

    // Fetch each note's details
    const noteIds = associations.results.map((a) => a.toObjectId);

    for (const noteId of noteIds) {
      try {
        const note = await client.crm.objects.notes.basicApi.getById(
          noteId,
          ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id']
        );

        notes.push({
          id: note.id,
          properties: {
            hs_note_body: note.properties.hs_note_body,
            hs_timestamp: note.properties.hs_timestamp,
            hubspot_owner_id: note.properties.hubspot_owner_id,
          },
        });
      } catch (error) {
        // Skip notes that can't be fetched
        console.warn(`Failed to fetch note ${noteId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to get associations for deal ${dealId}:`, error);
  }

  return notes;
}

export interface HubSpotEmail {
  id: string;
  subject: string;
  body: string;
  direction: string | null;
  timestamp: string | null;
  fromEmail: string | null;
}

export async function getEmailsByDealId(dealId: string): Promise<HubSpotEmail[]> {
  const client = getHubSpotClient();
  const emailIds = new Set<string>();

  try {
    // Fetch deal→emails and deal→contacts associations in parallel
    const [dealEmailAssocs, contactAssocs] = await Promise.all([
      client.crm.associations.v4.basicApi
        .getPage('deals', dealId, 'emails', undefined, 15)
        .catch(() => ({ results: [] as { toObjectId: string }[] })),
      client.crm.associations.v4.basicApi
        .getPage('deals', dealId, 'contacts', undefined, 50)
        .catch(() => ({ results: [] as { toObjectId: string }[] })),
    ]);

    // Collect direct deal email IDs
    for (const a of dealEmailAssocs.results) {
      emailIds.add(a.toObjectId);
    }

    // Fetch contact→emails associations in parallel
    if (contactAssocs.results.length > 0) {
      const contactEmailResults = await Promise.all(
        contactAssocs.results.map((c) =>
          client.crm.associations.v4.basicApi
            .getPage('contacts', c.toObjectId, 'emails', undefined, 15)
            .catch(() => ({ results: [] as { toObjectId: string }[] }))
        )
      );
      for (const result of contactEmailResults) {
        for (const a of result.results) {
          emailIds.add(a.toObjectId);
        }
      }
    }

    if (emailIds.size === 0) return [];

    // Fetch email details (limit to 15 most relevant)
    const idsToFetch = Array.from(emailIds).slice(0, 15);
    const emails: HubSpotEmail[] = [];

    for (const eId of idsToFetch) {
      try {
        const email = await client.crm.objects.emails.basicApi.getById(
          eId,
          ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp', 'hs_email_from_email']
        );

        emails.push({
          id: email.id,
          subject: email.properties.hs_email_subject || '',
          body: email.properties.hs_email_text || '',
          direction: email.properties.hs_email_direction || null,
          timestamp: email.properties.hs_timestamp || null,
          fromEmail: email.properties.hs_email_from_email || null,
        });
      } catch {
        // Skip emails that can't be fetched
      }
    }

    // Sort by timestamp descending (newest first)
    emails.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    return emails;
  } catch {
    // No email associations
    return [];
  }
}

// ===== HubSpot Call Types =====

export interface HubSpotCall {
  id: string;
  properties: {
    hs_call_title: string | null;
    hs_call_body: string | null;
    hs_timestamp: string | null;
    hs_call_duration: string | null;
    hs_call_disposition: string | null;
  };
}

/**
 * Fetch calls associated with a deal (via direct deal→calls AND deal→contacts→calls)
 */
export async function getCallsByDealId(dealId: string): Promise<HubSpotCall[]> {
  const client = getHubSpotClient();
  const callIds = new Set<string>();

  try {
    // Fetch deal→calls and deal→contacts associations in parallel
    const [dealCallAssocs, contactAssocs] = await Promise.all([
      client.crm.associations.v4.basicApi
        .getPage('deals', dealId, 'calls', undefined, 15)
        .catch(() => ({ results: [] as { toObjectId: string }[] })),
      client.crm.associations.v4.basicApi
        .getPage('deals', dealId, 'contacts', undefined, 50)
        .catch(() => ({ results: [] as { toObjectId: string }[] })),
    ]);

    // Collect direct deal call IDs
    for (const a of dealCallAssocs.results) {
      callIds.add(a.toObjectId);
    }

    // Fetch contact→calls associations in parallel
    if (contactAssocs.results.length > 0) {
      const contactCallResults = await Promise.all(
        contactAssocs.results.map((c) =>
          client.crm.associations.v4.basicApi
            .getPage('contacts', c.toObjectId, 'calls', undefined, 15)
            .catch(() => ({ results: [] as { toObjectId: string }[] }))
        )
      );
      for (const result of contactCallResults) {
        for (const a of result.results) {
          callIds.add(a.toObjectId);
        }
      }
    }

    if (callIds.size === 0) return [];

    // Fetch call details (limit to 15 most relevant)
    const idsToFetch = Array.from(callIds).slice(0, 15);
    const calls: HubSpotCall[] = [];

    for (const callId of idsToFetch) {
      try {
        const call = await client.crm.objects.calls.basicApi.getById(
          callId,
          ['hs_call_title', 'hs_call_body', 'hs_timestamp', 'hs_call_duration', 'hs_call_disposition']
        );

        calls.push({
          id: call.id,
          properties: {
            hs_call_title: call.properties.hs_call_title || null,
            hs_call_body: call.properties.hs_call_body || null,
            hs_timestamp: call.properties.hs_timestamp || null,
            hs_call_duration: call.properties.hs_call_duration || null,
            hs_call_disposition: call.properties.hs_call_disposition || null,
          },
        });
      } catch (error) {
        console.warn(`Failed to fetch call ${callId}:`, error);
      }
    }

    // Sort by timestamp descending (newest first)
    calls.sort((a, b) => {
      const timeA = a.properties.hs_timestamp ? new Date(a.properties.hs_timestamp).getTime() : 0;
      const timeB = b.properties.hs_timestamp ? new Date(b.properties.hs_timestamp).getTime() : 0;
      return timeB - timeA;
    });

    return calls;
  } catch (error) {
    console.warn(`Failed to get call associations for deal ${dealId}:`, error);
    return [];
  }
}

/**
 * Fetch notes for a deal with author names resolved
 * Used for AI context generation where knowing who wrote notes adds context
 */
export async function getNotesByDealIdWithAuthor(
  dealId: string,
  ownerMap?: Map<string, string>
): Promise<HubSpotNoteWithAuthor[]> {
  const client = getHubSpotClient();
  const notes: HubSpotNoteWithAuthor[] = [];

  try {
    // Get associations using v4 API: deals -> notes
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'notes',
      undefined,
      100
    );

    if (associations.results.length === 0) {
      return notes;
    }

    // Build owner map if not provided
    let resolvedOwnerMap = ownerMap;
    if (!resolvedOwnerMap) {
      resolvedOwnerMap = new Map();
      try {
        const owners = await client.crm.owners.ownersApi.getPage();
        for (const owner of owners.results) {
          const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || 'Unknown';
          resolvedOwnerMap.set(owner.id, name);
        }
      } catch {
        // Continue without owner names if lookup fails
      }
    }

    // Fetch each note's details
    const noteIds = associations.results.map((a) => a.toObjectId);

    for (const noteId of noteIds) {
      try {
        const note = await client.crm.objects.notes.basicApi.getById(
          noteId,
          ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id']
        );

        const ownerId = note.properties.hubspot_owner_id;
        const authorName = ownerId ? resolvedOwnerMap.get(ownerId) || null : null;

        notes.push({
          id: note.id,
          properties: {
            hs_note_body: note.properties.hs_note_body,
            hs_timestamp: note.properties.hs_timestamp,
            hubspot_owner_id: note.properties.hubspot_owner_id,
          },
          authorName,
        });
      } catch (error) {
        // Skip notes that can't be fetched
        console.warn(`Failed to fetch note ${noteId}:`, error);
      }
    }

    // Sort by timestamp descending (newest first)
    notes.sort((a, b) => {
      const timeA = a.properties.hs_timestamp ? new Date(a.properties.hs_timestamp).getTime() : 0;
      const timeB = b.properties.hs_timestamp ? new Date(b.properties.hs_timestamp).getTime() : 0;
      return timeB - timeA;
    });
  } catch (error) {
    console.warn(`Failed to get note associations for deal ${dealId}:`, error);
  }

  return notes;
}

// ===== HubSpot Task Types =====

export interface HubSpotTask {
  id: string;
  properties: {
    hs_task_subject: string | null;
    hs_task_status: string | null;
    hs_timestamp: string | null; // Due date
    hubspot_owner_id: string | null;
  };
}

/**
 * Fetch tasks associated with a deal
 */
export async function getTasksByDealId(dealId: string): Promise<HubSpotTask[]> {
  const client = getHubSpotClient();
  const tasks: HubSpotTask[] = [];

  try {
    // Get associations using v4 API: deals -> tasks
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'tasks',
      undefined,
      100
    );

    if (associations.results.length === 0) {
      return tasks;
    }

    // Fetch each task's details
    const taskIds = associations.results.map((a) => a.toObjectId);

    for (const taskId of taskIds) {
      try {
        const task = await client.crm.objects.tasks.basicApi.getById(
          taskId,
          ['hs_task_subject', 'hs_task_status', 'hs_timestamp', 'hubspot_owner_id']
        );

        tasks.push({
          id: task.id,
          properties: {
            hs_task_subject: task.properties.hs_task_subject || null,
            hs_task_status: task.properties.hs_task_status || null,
            hs_timestamp: task.properties.hs_timestamp || null,
            hubspot_owner_id: task.properties.hubspot_owner_id || null,
          },
        });
      } catch (error) {
        // Skip tasks that can't be fetched
        console.warn(`Failed to fetch task ${taskId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to get task associations for deal ${dealId}:`, error);
  }

  return tasks;
}
