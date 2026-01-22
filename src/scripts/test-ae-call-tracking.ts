/**
 * AE Call Tracking Feasibility Test Script
 *
 * Tests whether we can track calls logged by Account Executives in HubSpot.
 * This is a feasibility investigation that will inform dashboard metrics/queue development.
 *
 * Run with: npx tsx src/scripts/test-ae-call-tracking.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { getHubSpotClient } from '../lib/hubspot/client';
import { createServiceClient } from '../lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '../lib/utils/quarter';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/calls';

// Target AE for testing
const TARGET_AE_EMAIL = 'aboyd@opusbehavioral.com';

interface CallData {
  id: string;
  timestamp: Date;
  title: string | null;
  duration: number | null; // milliseconds
  status: string | null;
  outcome: string | null;
  body: string | null;
  associatedContacts: Array<{ id: string; email?: string; name?: string }>;
}

async function getOwnerIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('owners')
    .select('hubspot_owner_id')
    .eq('email', email)
    .single();

  if (error || !data) {
    console.error(`Could not find owner with email ${email}:`, error?.message);
    return null;
  }

  return data.hubspot_owner_id;
}

async function getOwnerName(email: string): Promise<string> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('owners')
    .select('first_name, last_name')
    .eq('email', email)
    .single();

  if (data) {
    return [data.first_name, data.last_name].filter(Boolean).join(' ') || email;
  }

  return email;
}

async function fetchCallsByOwner(
  ownerId: string,
  startDate: Date,
  endDate: Date
): Promise<CallData[]> {
  const client = getHubSpotClient();
  const calls: CallData[] = [];
  let after: string | undefined;

  const startTimestamp = startDate.getTime().toString();
  const endTimestamp = endDate.getTime().toString();

  console.log(`\nSearching for calls from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`Owner ID: ${ownerId}`);

  do {
    try {
      const response = await client.crm.objects.calls.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Gte,
                value: startTimestamp,
              },
              {
                propertyName: 'hs_timestamp',
                operator: FilterOperatorEnum.Lte,
                value: endTimestamp,
              },
            ],
          },
        ],
        properties: [
          'hs_timestamp',
          'hs_call_duration',
          'hs_call_status',
          'hs_call_disposition',
          'hs_call_title',
          'hs_call_body',
          'hubspot_owner_id',
        ],
        limit: 100,
        after: after ? after : undefined,
      });

      for (const call of response.results) {
        calls.push({
          id: call.id,
          timestamp: call.properties.hs_timestamp
            ? new Date(call.properties.hs_timestamp)
            : new Date(),
          title: call.properties.hs_call_title || null,
          duration: call.properties.hs_call_duration
            ? parseInt(call.properties.hs_call_duration, 10)
            : null,
          status: call.properties.hs_call_status || null,
          outcome: call.properties.hs_call_disposition || null,
          body: call.properties.hs_call_body || null,
          associatedContacts: [],
        });
      }

      after = response.paging?.next?.after;
    } catch (error) {
      console.error('Error searching calls:', error);
      break;
    }
  } while (after);

  return calls;
}

async function fetchAssociatedContacts(callId: string): Promise<Array<{ id: string; email?: string; name?: string }>> {
  const client = getHubSpotClient();
  const contacts: Array<{ id: string; email?: string; name?: string }> = [];

  try {
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'calls',
      callId,
      'contacts',
      undefined,
      100
    );

    for (const assoc of associations.results) {
      try {
        const contact = await client.crm.contacts.basicApi.getById(
          assoc.toObjectId,
          ['email', 'firstname', 'lastname']
        );

        contacts.push({
          id: contact.id,
          email: contact.properties.email || undefined,
          name: [contact.properties.firstname, contact.properties.lastname]
            .filter(Boolean)
            .join(' ') || undefined,
        });
      } catch {
        // Contact might not be accessible, just record the ID
        contacts.push({ id: assoc.toObjectId });
      }
    }
  } catch {
    // No associations or error fetching
  }

  return contacts;
}

function formatDuration(milliseconds: number | null): string {
  if (!milliseconds) return 'N/A';
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${seconds} sec`;
  }
  return `${minutes} min ${remainingSeconds} sec`;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as start of week
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

async function getCallOutcomeLabels(): Promise<Map<string, string>> {
  const client = getHubSpotClient();
  const outcomeMap = new Map<string, string>();

  try {
    // Fetch the hs_call_disposition property to get option labels
    const property = await client.crm.properties.coreApi.getByName(
      'calls',
      'hs_call_disposition'
    );

    if (property.options) {
      for (const option of property.options) {
        outcomeMap.set(option.value, option.label);
      }
    }
  } catch {
    // If we can't fetch property options, outcomes will show as IDs
  }

  // Note: Custom dispositions from integrations (Zoom, Aircall, etc.) may not
  // have labels defined in HubSpot. These will show as GUIDs.
  return outcomeMap;
}

function truncateId(id: string): string {
  // If it looks like a GUID, truncate it for display
  if (id.length > 20 && id.includes('-')) {
    return id.substring(0, 8) + '...';
  }
  return id;
}

function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDurationForCSV(milliseconds: number | null): string {
  if (!milliseconds) return '';
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function writeCallsToCSV(
  calls: CallData[],
  outcomeLabels: Map<string, string>,
  outputPath: string
): void {
  const headers = ['Date', 'Title', 'Duration', 'Status', 'Outcome', 'Contact Name', 'Contact Email'];
  const rows: string[] = [headers.join(',')];

  // Sort calls by date descending
  const sortedCalls = [...calls].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  for (const call of sortedCalls) {
    const date = call.timestamp.toISOString().split('T')[0];
    const title = call.title || '';
    const duration = formatDurationForCSV(call.duration);
    const status = call.status || '';
    const outcomeId = call.outcome || '';
    const outcome = outcomeLabels.get(outcomeId) || outcomeId;

    // Get first contact info if available
    const contact = call.associatedContacts[0];
    const contactName = contact?.name || '';
    const contactEmail = contact?.email || '';

    const row = [
      escapeCSV(date),
      escapeCSV(title),
      escapeCSV(duration),
      escapeCSV(status),
      escapeCSV(outcome),
      escapeCSV(contactName),
      escapeCSV(contactEmail),
    ].join(',');

    rows.push(row);
  }

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');
}

async function main() {
  console.log('='.repeat(60));
  console.log('CALL TRACKING FEASIBILITY TEST');
  console.log('='.repeat(60));

  // Get owner info
  const ownerId = await getOwnerIdByEmail(TARGET_AE_EMAIL);
  if (!ownerId) {
    console.error(`\nFailed to find owner ID for ${TARGET_AE_EMAIL}`);
    console.log('Make sure the HubSpot sync has run and the owner exists in Supabase.');
    process.exit(1);
  }

  const ownerName = await getOwnerName(TARGET_AE_EMAIL);

  // Get date range (current quarter)
  const currentQuarter = getCurrentQuarter();
  const startDate = currentQuarter.startDate;
  const endDate = new Date(); // Now

  console.log(`Account Executive: ${ownerName} (${TARGET_AE_EMAIL})`);
  console.log(`Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`Quarter: ${currentQuarter.label}`);
  console.log('='.repeat(60));

  // Fetch outcome labels for human-readable display
  console.log('\nFetching call disposition options...');
  const outcomeLabels = await getCallOutcomeLabels();

  // Fetch calls
  console.log('Fetching calls from HubSpot...');
  const calls = await fetchCallsByOwner(ownerId, startDate, endDate);

  console.log(`\nFound ${calls.length} calls`);

  if (calls.length === 0) {
    console.log('\nNo calls found for this AE in the date range.');
    console.log('\nPossible reasons:');
    console.log('  1. The AE has not logged any calls in HubSpot');
    console.log('  2. Calls are logged under a different owner ID');
    console.log('  3. The date range is too narrow');

    // Try fetching calls without date filter to see if any exist
    console.log('\n--- Checking for ANY calls by this owner (no date filter) ---');

    const client = getHubSpotClient();
    try {
      const allCallsResponse = await client.crm.objects.calls.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
            ],
          },
        ],
        properties: ['hs_timestamp', 'hs_call_title'],
        limit: 10,
      });

      if (allCallsResponse.results.length > 0) {
        console.log(`Found ${allCallsResponse.total || allCallsResponse.results.length} total calls for this owner`);
        console.log('Most recent calls:');
        for (const call of allCallsResponse.results.slice(0, 5)) {
          const ts = call.properties.hs_timestamp
            ? new Date(call.properties.hs_timestamp).toISOString().split('T')[0]
            : 'Unknown date';
          console.log(`  - ${ts}: ${call.properties.hs_call_title || '(no title)'}`);
        }
      } else {
        console.log('No calls found for this owner at all.');
      }
    } catch (error) {
      console.error('Error checking all calls:', error);
    }

    console.log('\n' + '='.repeat(60));
    console.log('FEASIBILITY: ⚠️ INCONCLUSIVE - No calls found for test AE');
    console.log('='.repeat(60));
    return;
  }

  // Fetch associated contacts for ALL calls (needed for CSV export)
  console.log('\nFetching contact associations for all calls...');
  let callsWithContacts = 0;

  for (let i = 0; i < calls.length; i++) {
    calls[i].associatedContacts = await fetchAssociatedContacts(calls[i].id);
    if (calls[i].associatedContacts.length > 0) {
      callsWithContacts++;
    }
    // Progress indicator every 10 calls
    if ((i + 1) % 10 === 0) {
      console.log(`  Processed ${i + 1}/${calls.length} calls...`);
    }
    // Small delay to avoid rate limiting
    if (i < calls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  const contactRatio = calls.length > 0 ? callsWithContacts / calls.length : 0;

  // Analyze by outcome
  const outcomeCount: Record<string, number> = {};
  for (const call of calls) {
    const outcome = call.outcome || 'Unknown';
    outcomeCount[outcome] = (outcomeCount[outcome] || 0) + 1;
  }

  // Analyze by status
  const statusCount: Record<string, number> = {};
  for (const call of calls) {
    const status = call.status || 'Unknown';
    statusCount[status] = (statusCount[status] || 0) + 1;
  }

  // Analyze by week
  const weekCount: Record<string, number> = {};
  for (const call of calls) {
    const weekStart = getWeekStart(call.timestamp);
    weekCount[weekStart] = (weekCount[weekStart] || 0) + 1;
  }

  // Sort weeks descending
  const sortedWeeks = Object.entries(weekCount).sort((a, b) => b[0].localeCompare(a[0]));

  // Calculate average call duration
  const callsWithDuration = calls.filter(c => c.duration !== null);
  const avgDuration = callsWithDuration.length > 0
    ? callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / callsWithDuration.length
    : 0;

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total calls logged: ${calls.length}`);
  console.log(`Calls with contacts: ${callsWithContacts} (${Math.round(contactRatio * 100)}%)`);
  console.log(`Average call duration: ${formatDuration(avgDuration)}`);

  console.log('\nBY OUTCOME (disposition)');
  console.log('-'.repeat(30));
  const hasCustomDispositions = Object.keys(outcomeCount).some(k => k.includes('-') && k.length > 20);
  if (hasCustomDispositions) {
    console.log('(Note: Custom disposition IDs from calling integration)');
  }
  for (const [outcome, count] of Object.entries(outcomeCount).sort((a, b) => b[1] - a[1])) {
    const label = outcomeLabels.get(outcome) || truncateId(outcome);
    console.log(`${label}: ${count}`);
  }

  console.log('\nBY STATUS');
  console.log('-'.repeat(30));
  for (const [status, count] of Object.entries(statusCount).sort((a, b) => b[1] - a[1])) {
    console.log(`${status}: ${count}`);
  }

  console.log('\nBY WEEK');
  console.log('-'.repeat(30));
  for (const [week, count] of sortedWeeks.slice(0, 8)) {
    console.log(`Week of ${week}: ${count} calls`);
  }

  // Print sample calls
  console.log('\nSAMPLE CALLS (most recent 5)');
  console.log('-'.repeat(30));

  // Sort by timestamp descending
  const sortedCalls = [...calls].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  for (let i = 0; i < Math.min(5, sortedCalls.length); i++) {
    const call = sortedCalls[i];
    const dateStr = call.timestamp.toISOString().split('T')[0];
    const title = call.title || '(no title)';
    const outcomeId = call.outcome || 'Unknown';
    const outcome = outcomeLabels.get(outcomeId) || truncateId(outcomeId);
    const duration = formatDuration(call.duration);

    console.log(`${i + 1}. ${dateStr} - "${title}" (${outcome}, ${duration})`);

    if (call.associatedContacts.length > 0) {
      const contact = call.associatedContacts[0];
      const contactInfo = contact.name || contact.email || `ID: ${contact.id}`;
      console.log(`   Contact: ${contactInfo}`);
    }
  }

  // Export to CSV
  const csvPath = path.join(process.cwd(), 'ae-calls-export.csv');
  console.log('\n' + '='.repeat(60));
  console.log('EXPORTING TO CSV');
  console.log('='.repeat(60));
  writeCallsToCSV(calls, outcomeLabels, csvPath);
  console.log(`CSV exported to: ${csvPath}`);
  console.log(`Total rows: ${calls.length}`);

  console.log('\n' + '='.repeat(60));
  console.log('FEASIBILITY: ✅ YES - Call tracking is possible via HubSpot API');
  console.log('='.repeat(60));
  console.log('\nNext steps for dashboard integration:');
  console.log('  1. Add "Calls This Week" metric card to AE dashboard');
  console.log('  2. Create weekly call activity chart');
  console.log('  3. Consider call-to-deal association tracking');
}

main().catch(console.error);
