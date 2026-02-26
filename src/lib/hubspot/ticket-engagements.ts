/**
 * Ticket engagement timeline fetcher.
 * Fetches all engagement types (emails, notes, calls, meetings) associated
 * with a HubSpot ticket and returns a unified, sorted timeline.
 */

import { getHubSpotClient } from './client';

// --- Types ---

export interface TicketEngagement {
  id: string;
  type: 'email' | 'note' | 'call' | 'meeting';
  timestamp: Date;
  subject?: string;
  body?: string;
  direction?: string;
  fromEmail?: string;
  toEmail?: string;
  author?: string;
  duration?: number;
  disposition?: string;
}

export interface TicketEngagementTimeline {
  engagements: TicketEngagement[];
  counts: { emails: number; notes: number; calls: number; meetings: number; total: number };
}

// --- Helpers ---

async function fetchAssociatedIds(
  fromType: string,
  fromId: string,
  toType: string,
  limit = 50
): Promise<string[]> {
  const client = getHubSpotClient();
  try {
    const result = await client.crm.associations.v4.basicApi.getPage(
      fromType,
      fromId,
      toType,
      undefined,
      limit
    );
    return result.results.map((a) => a.toObjectId);
  } catch {
    return [];
  }
}

async function fetchOwnerMap(): Promise<Map<string, string>> {
  const client = getHubSpotClient();
  const map = new Map<string, string>();
  try {
    const owners = await client.crm.owners.ownersApi.getPage();
    for (const owner of owners.results) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || 'Unknown';
      map.set(owner.id, name);
    }
  } catch {
    // Continue without owner names
  }
  return map;
}

const MAX_PER_TYPE = 20;

// --- Main Export ---

export async function getTicketEngagementTimeline(
  ticketId: string,
  ownerMap?: Map<string, string>
): Promise<TicketEngagementTimeline> {
  const client = getHubSpotClient();

  // Resolve owner names if not provided
  const owners = ownerMap ?? await fetchOwnerMap();

  // Fetch all association IDs in parallel
  const [emailIds, noteIds, callIds, meetingIds] = await Promise.all([
    fetchAssociatedIds('tickets', ticketId, 'emails'),
    fetchAssociatedIds('tickets', ticketId, 'notes'),
    fetchAssociatedIds('tickets', ticketId, 'calls'),
    fetchAssociatedIds('tickets', ticketId, 'meetings'),
  ]);

  const engagements: TicketEngagement[] = [];

  // Fetch email details (limit to most recent)
  const emailFetches = emailIds.slice(0, MAX_PER_TYPE).map(async (id) => {
    try {
      const email = await client.crm.objects.emails.basicApi.getById(id, [
        'hs_email_subject',
        'hs_email_direction',
        'hs_timestamp',
        'hs_email_from_email',
        'hs_email_to_email',
        'hs_email_text',
      ]);
      const ts = email.properties.hs_timestamp;
      if (ts) {
        engagements.push({
          id,
          type: 'email',
          timestamp: new Date(ts),
          subject: email.properties.hs_email_subject || undefined,
          body: (email.properties.hs_email_text || '').slice(0, 500) || undefined,
          direction: email.properties.hs_email_direction || undefined,
          fromEmail: email.properties.hs_email_from_email || undefined,
          toEmail: email.properties.hs_email_to_email || undefined,
        });
      }
    } catch {
      // Skip failed fetches
    }
  });

  // Fetch note details
  const noteFetches = noteIds.slice(0, MAX_PER_TYPE).map(async (id) => {
    try {
      const note = await client.crm.objects.notes.basicApi.getById(id, [
        'hs_note_body',
        'hs_timestamp',
        'hubspot_owner_id',
      ]);
      const ts = note.properties.hs_timestamp;
      if (ts) {
        const ownerId = note.properties.hubspot_owner_id;
        const authorName = ownerId ? owners.get(ownerId) || `Owner ${ownerId}` : undefined;
        const bodyText = (note.properties.hs_note_body || '')
          .replace(/<[^>]*>/g, '')
          .slice(0, 500);
        engagements.push({
          id,
          type: 'note',
          timestamp: new Date(ts),
          body: bodyText || undefined,
          author: authorName,
        });
      }
    } catch {
      // Skip failed fetches
    }
  });

  // Fetch call details
  const callFetches = callIds.slice(0, MAX_PER_TYPE).map(async (id) => {
    try {
      const call = await client.crm.objects.calls.basicApi.getById(id, [
        'hs_call_title',
        'hs_timestamp',
        'hs_call_duration',
        'hs_call_disposition',
        'hubspot_owner_id',
        'hs_call_body',
      ]);
      const ts = call.properties.hs_timestamp;
      if (ts) {
        const ownerId = call.properties.hubspot_owner_id;
        const authorName = ownerId ? owners.get(ownerId) || `Owner ${ownerId}` : undefined;
        const durationMs = call.properties.hs_call_duration
          ? Number(call.properties.hs_call_duration)
          : undefined;
        engagements.push({
          id,
          type: 'call',
          timestamp: new Date(ts),
          subject: call.properties.hs_call_title || undefined,
          body: (call.properties.hs_call_body || '').replace(/<[^>]*>/g, '').slice(0, 500) || undefined,
          author: authorName,
          duration: durationMs ? Math.round(durationMs / 1000) : undefined,
          disposition: call.properties.hs_call_disposition || undefined,
        });
      }
    } catch {
      // Skip failed fetches
    }
  });

  // Fetch meeting details
  const meetingFetches = meetingIds.slice(0, MAX_PER_TYPE).map(async (id) => {
    try {
      const meeting = await client.crm.objects.meetings.basicApi.getById(id, [
        'hs_meeting_title',
        'hs_timestamp',
        'hubspot_owner_id',
      ]);
      const ts = meeting.properties.hs_timestamp;
      if (ts) {
        const ownerId = meeting.properties.hubspot_owner_id;
        const authorName = ownerId ? owners.get(ownerId) || `Owner ${ownerId}` : undefined;
        engagements.push({
          id,
          type: 'meeting',
          timestamp: new Date(ts),
          subject: meeting.properties.hs_meeting_title || undefined,
          author: authorName,
        });
      }
    } catch {
      // Skip failed fetches
    }
  });

  // Fetch all engagement details in parallel
  await Promise.all([...emailFetches, ...noteFetches, ...callFetches, ...meetingFetches]);

  // Sort newest-first
  engagements.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    engagements,
    counts: {
      emails: emailIds.length,
      notes: noteIds.length,
      calls: callIds.length,
      meetings: meetingIds.length,
      total: emailIds.length + noteIds.length + callIds.length + meetingIds.length,
    },
  };
}
