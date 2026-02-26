/**
 * Batch engagement fetching for PPL Sequence compliance.
 *
 * Replaces per-deal sequential API calls with HubSpot batch APIs.
 * Reduces ~960 API calls (for 40 deals) down to ~10-13 batch calls.
 */

import { getHubSpotClient } from './client';
import { chunk } from '@/lib/utils/chunk';
import type { HubSpotCall, HubSpotEmail, HubSpotMeeting } from './engagements';

const BATCH_SIZE = 100;
const PER_DEAL_CAP = 15; // Match existing per-deal engagement cap

interface DealEngagements {
  calls: HubSpotCall[];
  emails: HubSpotEmail[];
  meetings: HubSpotMeeting[];
}

/**
 * Batch-fetch associations from one object type to another.
 * Returns a map of fromId → Set<toId>.
 */
async function batchFetchAssociations(
  fromType: string,
  toType: string,
  fromIds: string[]
): Promise<Map<string, Set<string>>> {
  const client = getHubSpotClient();
  const result = new Map<string, Set<string>>();

  for (const id of fromIds) {
    result.set(id, new Set());
  }

  for (const idChunk of chunk(fromIds, BATCH_SIZE)) {
    try {
      const response = await client.crm.associations.batchApi.read(
        fromType,
        toType,
        { inputs: idChunk.map((id) => ({ id })) }
      );

      for (const assoc of response.results) {
        const fromId = assoc._from.id;
        const existing = result.get(fromId) || new Set<string>();
        for (const to of assoc.to) {
          existing.add(to.id);
        }
        result.set(fromId, existing);
      }
    } catch (error) {
      console.warn(`[batch-engagements] Failed batch ${fromType}→${toType}:`, error);
      // Affected IDs keep empty sets — deals will get needsActivityCheck
    }
  }

  return result;
}

/**
 * Batch-fetch call details by ID.
 */
async function batchFetchCallDetails(callIds: string[]): Promise<Map<string, HubSpotCall>> {
  const client = getHubSpotClient();
  const result = new Map<string, HubSpotCall>();

  if (callIds.length === 0) return result;

  for (const idChunk of chunk(callIds, BATCH_SIZE)) {
    try {
      const response = await client.crm.objects.calls.batchApi.read({
        inputs: idChunk.map((id) => ({ id })),
        properties: [
          'hs_timestamp',
          'hs_call_title',
          'hs_call_body',
          'hs_call_duration',
          'hs_call_disposition',
          'hs_call_direction',
        ],
        propertiesWithHistory: [],
      });

      for (const call of response.results) {
        result.set(call.id, {
          id: call.id,
          properties: {
            hs_call_title: call.properties.hs_call_title || null,
            hs_call_body: call.properties.hs_call_body || null,
            hs_timestamp: call.properties.hs_timestamp || null,
            hs_call_duration: call.properties.hs_call_duration || null,
            hs_call_disposition: call.properties.hs_call_disposition || null,
            hs_call_direction: call.properties.hs_call_direction || null,
          },
        });
      }
    } catch (error) {
      console.warn('[batch-engagements] Failed batch call details fetch:', error);
    }
  }

  return result;
}

/**
 * Batch-fetch email details by ID.
 */
async function batchFetchEmailDetails(emailIds: string[]): Promise<Map<string, HubSpotEmail>> {
  const client = getHubSpotClient();
  const result = new Map<string, HubSpotEmail>();

  if (emailIds.length === 0) return result;

  for (const idChunk of chunk(emailIds, BATCH_SIZE)) {
    try {
      const response = await client.crm.objects.emails.batchApi.read({
        inputs: idChunk.map((id) => ({ id })),
        properties: [
          'hs_email_subject',
          'hs_email_text',
          'hs_email_direction',
          'hs_timestamp',
          'hs_email_from_email',
        ],
        propertiesWithHistory: [],
      });

      for (const email of response.results) {
        result.set(email.id, {
          id: email.id,
          subject: email.properties.hs_email_subject || '',
          body: email.properties.hs_email_text || '',
          direction: email.properties.hs_email_direction || null,
          timestamp: email.properties.hs_timestamp || null,
          fromEmail: email.properties.hs_email_from_email || null,
        });
      }
    } catch (error) {
      console.warn('[batch-engagements] Failed batch email details fetch:', error);
    }
  }

  return result;
}

/**
 * Batch-fetch meeting details by ID.
 */
async function batchFetchMeetingDetails(meetingIds: string[]): Promise<Map<string, HubSpotMeeting>> {
  const client = getHubSpotClient();
  const result = new Map<string, HubSpotMeeting>();

  if (meetingIds.length === 0) return result;

  for (const idChunk of chunk(meetingIds, BATCH_SIZE)) {
    try {
      const response = await client.crm.objects.meetings.batchApi.read({
        inputs: idChunk.map((id) => ({ id })),
        properties: [
          'hs_meeting_title',
          'hs_timestamp',
          'hs_createdate',
        ],
        propertiesWithHistory: [],
      });

      for (const meeting of response.results) {
        result.set(meeting.id, {
          id: meeting.id,
          properties: {
            hs_meeting_title: meeting.properties.hs_meeting_title || null,
            hs_timestamp: meeting.properties.hs_timestamp || null,
            hs_createdate: meeting.properties.hs_createdate || null,
          },
        });
      }
    } catch (error) {
      console.warn('[batch-engagements] Failed batch meeting details fetch:', error);
    }
  }

  return result;
}

/**
 * Batch-fetch all engagements (calls, emails, meetings) for a list of deals.
 *
 * Replaces per-deal sequential getCallsByDealId/getEmailsByDealId/getMeetingsByDealId
 * with bulk batch API calls, reducing ~960 API calls to ~10-13 for 40 deals.
 *
 * @param dealIds - Array of HubSpot deal IDs
 * @returns Map of dealId → { calls, emails, meetings }
 */
export async function batchFetchDealEngagements(
  dealIds: string[]
): Promise<Map<string, DealEngagements>> {
  const result = new Map<string, DealEngagements>();

  // Initialize all deals with empty engagements
  for (const id of dealIds) {
    result.set(id, { calls: [], emails: [], meetings: [] });
  }

  if (dealIds.length === 0) return result;

  // ── Phase 1: Batch fetch deal-level associations (4 parallel calls) ──
  const [dealCallAssocs, dealEmailAssocs, dealMeetingAssocs, dealContactAssocs] = await Promise.all([
    batchFetchAssociations('deals', 'calls', dealIds),
    batchFetchAssociations('deals', 'emails', dealIds),
    batchFetchAssociations('deals', 'meetings', dealIds),
    batchFetchAssociations('deals', 'contacts', dealIds),
  ]);

  // ── Phase 2: Batch fetch contact→engagement associations (3 parallel calls) ──
  // Collect all unique contact IDs across all deals
  const allContactIds = new Set<string>();
  for (const contactSet of dealContactAssocs.values()) {
    for (const cid of contactSet) {
      allContactIds.add(cid);
    }
  }

  const uniqueContactIds = Array.from(allContactIds);

  const [contactCallAssocs, contactEmailAssocs, contactMeetingAssocs] =
    uniqueContactIds.length > 0
      ? await Promise.all([
          batchFetchAssociations('contacts', 'calls', uniqueContactIds),
          batchFetchAssociations('contacts', 'emails', uniqueContactIds),
          batchFetchAssociations('contacts', 'meetings', uniqueContactIds),
        ])
      : [
          new Map<string, Set<string>>(),
          new Map<string, Set<string>>(),
          new Map<string, Set<string>>(),
        ];

  // ── Phase 3: Merge & deduplicate per deal (pure computation, 0 API calls) ──
  // Build per-deal engagement ID sets by unioning direct + contact-path IDs
  const dealCallIds = new Map<string, Set<string>>();
  const dealEmailIds = new Map<string, Set<string>>();
  const dealMeetingIds = new Map<string, Set<string>>();

  const allCallIds = new Set<string>();
  const allEmailIds = new Set<string>();
  const allMeetingIds = new Set<string>();

  for (const dealId of dealIds) {
    // Start with direct deal→engagement associations
    const callIds = new Set(dealCallAssocs.get(dealId) || []);
    const emailIds = new Set(dealEmailAssocs.get(dealId) || []);
    const meetingIds = new Set(dealMeetingAssocs.get(dealId) || []);

    // Add contact→engagement associations
    const contactIds = dealContactAssocs.get(dealId) || new Set();
    for (const contactId of contactIds) {
      const contactCalls = contactCallAssocs.get(contactId);
      if (contactCalls) {
        for (const cid of contactCalls) callIds.add(cid);
      }
      const contactEmails = contactEmailAssocs.get(contactId);
      if (contactEmails) {
        for (const eid of contactEmails) emailIds.add(eid);
      }
      const contactMeetings = contactMeetingAssocs.get(contactId);
      if (contactMeetings) {
        for (const mid of contactMeetings) meetingIds.add(mid);
      }
    }

    // Apply per-deal cap (matching existing 15-item limit)
    const cappedCallIds = new Set(Array.from(callIds).slice(0, PER_DEAL_CAP));
    const cappedEmailIds = new Set(Array.from(emailIds).slice(0, PER_DEAL_CAP));
    const cappedMeetingIds = new Set(Array.from(meetingIds).slice(0, PER_DEAL_CAP));

    dealCallIds.set(dealId, cappedCallIds);
    dealEmailIds.set(dealId, cappedEmailIds);
    dealMeetingIds.set(dealId, cappedMeetingIds);

    // Accumulate global unique sets for batch detail fetch
    for (const id of cappedCallIds) allCallIds.add(id);
    for (const id of cappedEmailIds) allEmailIds.add(id);
    for (const id of cappedMeetingIds) allMeetingIds.add(id);
  }

  // ── Phase 4: Batch fetch engagement details (3 parallel calls) ──
  const [callDetails, emailDetails, meetingDetails] = await Promise.all([
    batchFetchCallDetails(Array.from(allCallIds)),
    batchFetchEmailDetails(Array.from(allEmailIds)),
    batchFetchMeetingDetails(Array.from(allMeetingIds)),
  ]);

  // ── Phase 5: Assemble per-deal results ──
  for (const dealId of dealIds) {
    const dealResult = result.get(dealId)!;

    // Calls
    const callIdSet = dealCallIds.get(dealId) || new Set();
    for (const callId of callIdSet) {
      const call = callDetails.get(callId);
      if (call) dealResult.calls.push(call);
    }
    // Sort by timestamp descending (newest first)
    dealResult.calls.sort((a, b) => {
      const timeA = a.properties.hs_timestamp ? new Date(a.properties.hs_timestamp).getTime() : 0;
      const timeB = b.properties.hs_timestamp ? new Date(b.properties.hs_timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // Emails
    const emailIdSet = dealEmailIds.get(dealId) || new Set();
    for (const emailId of emailIdSet) {
      const email = emailDetails.get(emailId);
      if (email) dealResult.emails.push(email);
    }
    dealResult.emails.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // Meetings
    const meetingIdSet = dealMeetingIds.get(dealId) || new Set();
    for (const meetingId of meetingIdSet) {
      const meeting = meetingDetails.get(meetingId);
      if (meeting) dealResult.meetings.push(meeting);
    }
    dealResult.meetings.sort((a, b) => {
      const timeA = a.properties.hs_createdate ? new Date(a.properties.hs_createdate).getTime() : 0;
      const timeB = b.properties.hs_createdate ? new Date(b.properties.hs_createdate).getTime() : 0;
      return timeB - timeA;
    });
  }

  return result;
}
