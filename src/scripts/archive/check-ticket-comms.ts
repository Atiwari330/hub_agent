/**
 * Diagnostic script to validate last communication date on a HubSpot ticket.
 * Fetches all engagement types (emails, notes, calls, meetings) associated
 * with the ticket and reports the most recent communication timestamp.
 *
 * Run with: npx tsx src/scripts/check-ticket-comms.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

const TICKET_ID = '33570554644';

const TICKET_PROPERTIES = [
  'subject',
  'content',
  'source_type',
  'createdate',
  'hs_pipeline',
  'hs_pipeline_stage',
  'hubspot_owner_id',
  'hs_primary_company_name',
  'hs_is_closed',
  'hs_ticket_priority',
  'hs_lastcontacted',
  'last_reply_date',
  'hs_last_email_date',
  'hs_last_message_received_at',
  'hs_last_message_sent_at',
];

interface Engagement {
  id: string;
  type: 'email' | 'note' | 'call' | 'meeting';
  timestamp: Date;
  label: string;
  detail: string;
}

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

async function main() {
  const client = getHubSpotClient();

  console.log('='.repeat(70));
  console.log('  TICKET COMMUNICATION AUDIT');
  console.log(`  Ticket ID: ${TICKET_ID}`);
  console.log(`  Run date:  ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  // ------------------------------------------------------------------
  // STEP 1: Fetch ticket properties
  // ------------------------------------------------------------------
  console.log('\n--- STEP 1: Ticket Properties ---\n');

  try {
    const ticket = await client.crm.tickets.basicApi.getById(
      TICKET_ID,
      TICKET_PROPERTIES
    );
    const p = ticket.properties;

    console.log(`  Subject:          ${p.subject}`);
    console.log(`  Status (stage):   ${p.hs_pipeline_stage}`);
    console.log(`  Priority:         ${p.hs_ticket_priority}`);
    console.log(`  Owner ID:         ${p.hubspot_owner_id}`);
    console.log(`  Company:          ${p.hs_primary_company_name}`);
    console.log(`  Created:          ${p.createdate}`);
    console.log(`  Is Closed:        ${p.hs_is_closed}`);
    console.log(`  Source:           ${p.source_type}`);
    console.log(`  Last Contacted:   ${p.hs_lastcontacted || '(none)'}`);
    console.log(`  Last Reply Date:  ${p.last_reply_date || '(none)'}`);
    console.log(`  Last Email Date:  ${p.hs_last_email_date || '(none)'}`);
    console.log(`  Last Msg Recv'd:  ${p.hs_last_message_received_at || '(none)'}`);
    console.log(`  Last Msg Sent:    ${p.hs_last_message_sent_at || '(none)'}`);
  } catch (err) {
    console.error(`  ERROR fetching ticket: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // ------------------------------------------------------------------
  // STEP 2: Resolve owner name
  // ------------------------------------------------------------------
  let ownerMap = new Map<string, string>();
  try {
    const owners = await client.crm.owners.ownersApi.getPage();
    for (const owner of owners.results) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email || 'Unknown';
      ownerMap.set(owner.id, name);
    }
  } catch {
    // Continue without owner names
  }

  // ------------------------------------------------------------------
  // STEP 3: Fetch all engagement associations
  // ------------------------------------------------------------------
  console.log('\n--- STEP 2: Fetching Associations ---\n');

  const [emailIds, noteIds, callIds, meetingIds] = await Promise.all([
    fetchAssociatedIds('tickets', TICKET_ID, 'emails'),
    fetchAssociatedIds('tickets', TICKET_ID, 'notes'),
    fetchAssociatedIds('tickets', TICKET_ID, 'calls'),
    fetchAssociatedIds('tickets', TICKET_ID, 'meetings'),
  ]);

  console.log(`  Emails:   ${emailIds.length} associations`);
  console.log(`  Notes:    ${noteIds.length} associations`);
  console.log(`  Calls:    ${callIds.length} associations`);
  console.log(`  Meetings: ${meetingIds.length} associations`);

  const engagements: Engagement[] = [];

  // ------------------------------------------------------------------
  // STEP 4: Fetch email details
  // ------------------------------------------------------------------
  if (emailIds.length > 0) {
    console.log('\n--- STEP 3a: Email Details ---\n');
    for (const emailId of emailIds) {
      try {
        const email = await client.crm.objects.emails.basicApi.getById(emailId, [
          'hs_email_subject',
          'hs_email_direction',
          'hs_timestamp',
          'hs_email_from_email',
          'hs_email_to_email',
        ]);
        const ts = email.properties.hs_timestamp;
        if (ts) {
          const direction = email.properties.hs_email_direction || 'unknown';
          const from = email.properties.hs_email_from_email || 'unknown';
          const to = email.properties.hs_email_to_email || 'unknown';
          engagements.push({
            id: emailId,
            type: 'email',
            timestamp: new Date(ts),
            label: email.properties.hs_email_subject || '(no subject)',
            detail: `Direction: ${direction} | From: ${from} | To: ${to}`,
          });
        }
      } catch {
        console.warn(`  Could not fetch email ${emailId}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // STEP 5: Fetch note details
  // ------------------------------------------------------------------
  if (noteIds.length > 0) {
    console.log('\n--- STEP 3b: Note Details ---\n');
    for (const noteId of noteIds) {
      try {
        const note = await client.crm.objects.notes.basicApi.getById(noteId, [
          'hs_note_body',
          'hs_timestamp',
          'hubspot_owner_id',
        ]);
        const ts = note.properties.hs_timestamp;
        if (ts) {
          const ownerId = note.properties.hubspot_owner_id;
          const authorName = ownerId ? ownerMap.get(ownerId) || `Owner ${ownerId}` : 'Unknown';
          const bodyPreview = (note.properties.hs_note_body || '')
            .replace(/<[^>]*>/g, '')
            .slice(0, 100);
          engagements.push({
            id: noteId,
            type: 'note',
            timestamp: new Date(ts),
            label: `Note by ${authorName}`,
            detail: bodyPreview || '(empty)',
          });
        }
      } catch {
        console.warn(`  Could not fetch note ${noteId}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // STEP 6: Fetch call details
  // ------------------------------------------------------------------
  if (callIds.length > 0) {
    console.log('\n--- STEP 3c: Call Details ---\n');
    for (const callId of callIds) {
      try {
        const call = await client.crm.objects.calls.basicApi.getById(callId, [
          'hs_call_title',
          'hs_timestamp',
          'hs_call_duration',
          'hs_call_disposition',
          'hubspot_owner_id',
        ]);
        const ts = call.properties.hs_timestamp;
        if (ts) {
          const ownerId = call.properties.hubspot_owner_id;
          const callerName = ownerId ? ownerMap.get(ownerId) || `Owner ${ownerId}` : 'Unknown';
          const duration = call.properties.hs_call_duration
            ? `${Math.round(Number(call.properties.hs_call_duration) / 1000)}s`
            : 'unknown duration';
          engagements.push({
            id: callId,
            type: 'call',
            timestamp: new Date(ts),
            label: call.properties.hs_call_title || 'Call',
            detail: `By: ${callerName} | Duration: ${duration} | Disposition: ${call.properties.hs_call_disposition || 'n/a'}`,
          });
        }
      } catch {
        console.warn(`  Could not fetch call ${callId}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // STEP 7: Fetch meeting details
  // ------------------------------------------------------------------
  if (meetingIds.length > 0) {
    console.log('\n--- STEP 3d: Meeting Details ---\n');
    for (const meetingId of meetingIds) {
      try {
        const meeting = await client.crm.objects.meetings.basicApi.getById(meetingId, [
          'hs_meeting_title',
          'hs_timestamp',
          'hs_createdate',
          'hubspot_owner_id',
        ]);
        const ts = meeting.properties.hs_timestamp;
        if (ts) {
          const ownerId = meeting.properties.hubspot_owner_id;
          const organizerName = ownerId ? ownerMap.get(ownerId) || `Owner ${ownerId}` : 'Unknown';
          engagements.push({
            id: meetingId,
            type: 'meeting',
            timestamp: new Date(ts),
            label: meeting.properties.hs_meeting_title || 'Meeting',
            detail: `Organizer: ${organizerName} | Booked: ${meeting.properties.hs_createdate || 'unknown'}`,
          });
        }
      } catch {
        console.warn(`  Could not fetch meeting ${meetingId}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // STEP 8: Sort and display all engagements
  // ------------------------------------------------------------------
  engagements.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  console.log('\n' + '='.repeat(70));
  console.log(`  ALL ENGAGEMENTS (${engagements.length} total, sorted newest first)`);
  console.log('='.repeat(70));

  for (const eng of engagements) {
    const dateStr = eng.timestamp.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    console.log(`\n  [${eng.type.toUpperCase().padEnd(7)}] ${dateStr}`);
    console.log(`    ${eng.label}`);
    console.log(`    ${eng.detail}`);
    console.log(`    (ID: ${eng.id})`);
  }

  // ------------------------------------------------------------------
  // STEP 9: Summary
  // ------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));

  if (engagements.length === 0) {
    console.log('\n  No engagements found for this ticket.');
  } else {
    const latest = engagements[0];
    const now = new Date();
    const gapMs = now.getTime() - latest.timestamp.getTime();
    const gapDays = Math.floor(gapMs / (1000 * 60 * 60 * 24));
    const gapHours = Math.floor((gapMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const latestDateStr = latest.timestamp.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    console.log(`\n  Last communication:  ${latestDateStr} EST`);
    console.log(`  Type:                ${latest.type}`);
    console.log(`  Subject/Label:       ${latest.label}`);
    console.log(`  Detail:              ${latest.detail}`);
    console.log(`  Gap from now:        ${gapDays} days, ${gapHours} hours`);
    console.log(`  Total engagements:   ${engagements.length}`);

    // Breakdown by type
    const byType = engagements.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log(`  Breakdown:           ${Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ')}`);
  }

  console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
