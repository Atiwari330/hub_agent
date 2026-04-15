// @ts-nocheck
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

const TICKET_PROPERTIES = [
  'subject',
  'content',
  'hs_pipeline',
  'hs_pipeline_stage',
  'hs_ticket_priority',
  'hs_ticket_category',
  'source_type',
  'createdate',
  'closed_date',
  'hs_lastmodifieddate',
  'hs_last_activity_date',
  'hubspot_owner_id',
  'time_to_close',
  'time_to_first_agent_reply',
  'hs_resolution',
  'hs_conversations_originating_thread_id',
  'hs_num_associated_conversations',
  // Common custom fields
  'ball_in_court',
  'linear_task',
  'linear_task_id',
  'category',
  'ticket_type',
  'severity',
  'account_name',
];

async function main() {
  const client = getHubSpotClient();

  // 1. Fetch 20 most recent tickets
  console.log('=== FETCHING 20 MOST RECENT TICKETS ===\n');

  const searchResponse = await client.crm.tickets.searchApi.doSearch({
    filterGroups: [],
    properties: TICKET_PROPERTIES,
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' as const }],
    limit: 20,
    after: undefined as unknown as string,
  });

  console.log(`Found ${searchResponse.total} total tickets, fetched ${searchResponse.results.length}\n`);

  for (let i = 0; i < searchResponse.results.length; i++) {
    const ticket = searchResponse.results[i];
    const props = ticket.properties;

    console.log(`\n--- Ticket #${i + 1} (ID: ${ticket.id}) ---`);
    console.log(`  Subject: ${props.subject || '(none)'}`);
    console.log(`  Content: ${props.content ? props.content.substring(0, 200) : '(none)'}`);
    console.log(`  Pipeline: ${props.hs_pipeline || '(none)'}`);
    console.log(`  Stage: ${props.hs_pipeline_stage || '(none)'}`);
    console.log(`  Priority: ${props.hs_ticket_priority || '(none)'}`);
    console.log(`  Category: ${props.hs_ticket_category || props.category || '(none)'}`);
    console.log(`  Source: ${props.source_type || '(none)'}`);
    console.log(`  Created: ${props.createdate || '(none)'}`);
    console.log(`  Closed: ${props.closed_date || '(none)'}`);
    console.log(`  Last Activity: ${props.hs_last_activity_date || '(none)'}`);
    console.log(`  Owner ID: ${props.hubspot_owner_id || '(none)'}`);
    console.log(`  Time to Close: ${props.time_to_close || '(none)'}`);
    console.log(`  Time to First Reply: ${props.time_to_first_agent_reply || '(none)'}`);
    console.log(`  Resolution: ${props.hs_resolution || '(none)'}`);
    console.log(`  Thread ID: ${props.hs_conversations_originating_thread_id || '(none)'}`);
    console.log(`  # Conversations: ${props.hs_num_associated_conversations || '(none)'}`);

    // Print any non-null custom properties
    const customKeys = ['ball_in_court', 'linear_task', 'linear_task_id', 'category', 'ticket_type', 'severity', 'account_name'];
    const populatedCustom = customKeys.filter(
      (k) => props[k] !== null && props[k] !== undefined && props[k] !== ''
    );
    if (populatedCustom.length > 0) {
      console.log('  Custom fields:');
      for (const k of populatedCustom) {
        console.log(`    ${k}: ${props[k]}`);
      }
    }

    // 2. Fetch company associations via v4 API
    try {
      const assocResponse = await client.apiRequest({
        method: 'GET',
        path: `/crm/v4/objects/tickets/${ticket.id}/associations/companies`,
      });
      const assocData = await assocResponse.json() as {
        results?: Array<{ toObjectId: number }>;
      };
      if (assocData.results && assocData.results.length > 0) {
        console.log(`  Associated Companies: ${assocData.results.length}`);
        for (const assoc of assocData.results) {
          try {
            const company = await client.crm.companies.basicApi.getById(
              String(assoc.toObjectId),
              ['name']
            );
            console.log(`    - ${company.properties.name} (ID: ${assoc.toObjectId})`);
          } catch {
            console.log(`    - Company ID: ${assoc.toObjectId} (could not fetch name)`);
          }
        }
      } else {
        console.log('  Associated Companies: none');
      }
    } catch (err) {
      console.log(`  Associated Companies: error fetching - ${err instanceof Error ? err.message : err}`);
    }

    // 3. For first 3 tickets, try to read conversation content
    if (i < 3) {
      console.log('\n  --- Conversation / Activity Content ---');

      // Try thread ID
      const threadId = props.hs_conversations_originating_thread_id;
      if (threadId) {
        console.log(`  Thread ID: ${threadId}`);
        try {
          // Try the conversations API - GET /conversations/v3/conversations/threads/{threadId}/messages
          const messagesResponse = await client.apiRequest({
            method: 'GET',
            path: `/conversations/v3/conversations/threads/${threadId}/messages`,
          });
          const messagesData = await messagesResponse.json() as {
            results?: Array<{
              id: string;
              type: string;
              createdAt: string;
              text?: string;
              subject?: string;
              senders?: Array<{ name?: string; actorId?: string }>;
            }>;
          };
          if (messagesData.results && messagesData.results.length > 0) {
            console.log(`  Found ${messagesData.results.length} messages in thread:`);
            for (const msg of messagesData.results.slice(0, 5)) {
              console.log(`    [${msg.type}] ${msg.createdAt}`);
              if (msg.subject) console.log(`      Subject: ${msg.subject}`);
              if (msg.text) console.log(`      Text: ${msg.text.substring(0, 200)}`);
              if (msg.senders && msg.senders.length > 0) {
                console.log(`      From: ${msg.senders.map((s) => s.name || s.actorId).join(', ')}`);
              }
            }
          } else {
            console.log('  No messages found in thread');
          }
        } catch (err) {
          console.log(`  Could not fetch thread messages: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        console.log('  No originating thread ID on this ticket');
      }

      // Try associated emails via v4 API
      try {
        const emailAssocResp = await client.apiRequest({
          method: 'GET',
          path: `/crm/v4/objects/tickets/${ticket.id}/associations/emails`,
        });
        const emailAssocData = await emailAssocResp.json() as {
          results?: Array<{ toObjectId: number }>;
        };
        if (emailAssocData.results && emailAssocData.results.length > 0) {
          console.log(`  Associated Emails: ${emailAssocData.results.length}`);
          const firstEmailId = emailAssocData.results[0].toObjectId;
          try {
            const emailResp = await client.apiRequest({
              method: 'GET',
              path: `/crm/v3/objects/emails/${firstEmailId}?properties=hs_email_subject,hs_email_text,hs_email_direction,hs_timestamp`,
            });
            const emailData = await emailResp.json() as {
              properties: Record<string, string>;
            };
            console.log(`    First email:`);
            console.log(`      Subject: ${emailData.properties.hs_email_subject || '(none)'}`);
            console.log(`      Direction: ${emailData.properties.hs_email_direction || '(none)'}`);
            console.log(`      Date: ${emailData.properties.hs_timestamp || '(none)'}`);
            console.log(`      Text: ${emailData.properties.hs_email_text ? emailData.properties.hs_email_text.substring(0, 200) : '(none)'}`);
          } catch (err2) {
            console.log(`    Could not fetch email: ${err2 instanceof Error ? err2.message : err2}`);
          }
        } else {
          console.log('  Associated Emails: none');
        }
      } catch {
        console.log('  Could not fetch email associations');
      }

      // Try associated notes via v4 API
      try {
        const noteAssocResp = await client.apiRequest({
          method: 'GET',
          path: `/crm/v4/objects/tickets/${ticket.id}/associations/notes`,
        });
        const noteAssocData = await noteAssocResp.json() as {
          results?: Array<{ toObjectId: number }>;
        };
        if (noteAssocData.results && noteAssocData.results.length > 0) {
          console.log(`  Associated Notes: ${noteAssocData.results.length}`);
          const firstNoteId = noteAssocData.results[0].toObjectId;
          try {
            const noteResp = await client.apiRequest({
              method: 'GET',
              path: `/crm/v3/objects/notes/${firstNoteId}?properties=hs_note_body,hs_timestamp`,
            });
            const noteData = await noteResp.json() as {
              properties: Record<string, string>;
            };
            console.log(`    First note:`);
            console.log(`      Date: ${noteData.properties.hs_timestamp || '(none)'}`);
            console.log(`      Body: ${noteData.properties.hs_note_body ? noteData.properties.hs_note_body.substring(0, 200) : '(none)'}`);
          } catch (err2) {
            console.log(`    Could not fetch note: ${err2 instanceof Error ? err2.message : err2}`);
          }
        } else {
          console.log('  Associated Notes: none');
        }
      } catch {
        console.log('  Could not fetch note associations');
      }
    }
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
