/**
 * Diagnostic script to investigate Jake Beck deal touch counting
 * Target: Deal "Jake Beck - UpBeat Music Therapy Service" (ID: 53763740258)
 *
 * Dashboard shows 1 call + 1 email (2/6 touches).
 * HubSpot shows 2 calls + 1 email.
 * Hypothesis: 2nd call falls outside Week 1 window (first 5 business days).
 *
 * Run with: npx tsx src/scripts/investigate-jake-beck-deal.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getHubSpotClient } from '../lib/hubspot/client';
import { getCallsByDealId, getEmailsByDealId } from '../lib/hubspot/engagements';
import { addBusinessDays } from '../lib/utils/business-days';
import { countTouchesInRange, analyzeWeek1Touches } from '../lib/utils/touch-counter';

const DEAL_ID = '53763740258';

async function main() {
  const client = getHubSpotClient();

  console.log('='.repeat(70));
  console.log('INVESTIGATION: Jake Beck Deal - Week 1 Touch Window');
  console.log('Deal: Jake Beck - UpBeat Music Therapy Service');
  console.log('Deal ID: 53763740258');
  console.log('='.repeat(70));

  // Step 1: Fetch deal details and creation date
  console.log('\n--- Step 1: Deal Details ---');

  let createdAt: string | null = null;
  try {
    const deal = await client.crm.deals.basicApi.getById(DEAL_ID, [
      'dealname',
      'createdate',
      'hubspot_owner_id',
      'dealstage',
      'amount',
    ]);

    createdAt = deal.properties.createdate;
    console.log(`  Deal ID: ${deal.id}`);
    console.log(`  Name: ${deal.properties.dealname}`);
    console.log(`  Created: ${deal.properties.createdate}`);
    console.log(`  Owner ID: ${deal.properties.hubspot_owner_id}`);
    console.log(`  Stage: ${deal.properties.dealstage}`);
    console.log(`  Amount: ${deal.properties.amount}`);
  } catch (error) {
    console.error('  ERROR fetching deal:', error);
    return;
  }

  if (!createdAt) {
    console.error('  No creation date found - cannot compute Week 1 window');
    return;
  }

  // Step 2: Calculate Week 1 window
  console.log('\n--- Step 2: Week 1 Window Calculation ---');

  const createdDate = new Date(createdAt);
  const createdDateMidnight = new Date(createdDate);
  createdDateMidnight.setHours(0, 0, 0, 0);

  const week1End = addBusinessDays(createdDateMidnight, 5);
  week1End.setHours(23, 59, 59, 999);

  console.log(`  Deal created: ${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}`);
  console.log(`  Week 1 start: ${createdDateMidnight.toLocaleDateString()} (midnight)`);
  console.log(`  Week 1 end:   ${week1End.toLocaleDateString()} (23:59:59)`);
  console.log(`  Now:          ${new Date().toLocaleDateString()}`);
  console.log(`  In Week 1?    ${new Date() <= week1End ? 'YES' : 'NO'}`);

  // Step 3: Fetch calls via both paths
  console.log('\n--- Step 3: Fetch All Calls ---');

  // 3a: Direct deal→calls
  let directCallIds: string[] = [];
  try {
    const directAssocs = await client.crm.associations.v4.basicApi.getPage(
      'deals', DEAL_ID, 'calls', undefined, 50
    );
    directCallIds = directAssocs.results.map((a) => a.toObjectId);
    console.log(`  Direct deal->calls: ${directCallIds.length} associations`);
    for (const id of directCallIds) {
      console.log(`    Call ID: ${id}`);
    }
  } catch (error) {
    console.error('  ERROR fetching direct call associations:', error);
  }

  // 3b: Via contacts
  const contactCallIds: string[] = [];
  try {
    const contactAssocs = await client.crm.associations.v4.basicApi.getPage(
      'deals', DEAL_ID, 'contacts', undefined, 50
    );
    const contactIds = contactAssocs.results.map((a) => a.toObjectId);
    console.log(`\n  Deal->contacts: ${contactIds.length} contacts`);

    for (const contactId of contactIds) {
      const contactCalls = await client.crm.associations.v4.basicApi.getPage(
        'contacts', contactId, 'calls', undefined, 50
      );
      console.log(`    Contact ${contactId} -> ${contactCalls.results.length} calls`);
      for (const a of contactCalls.results) {
        if (!directCallIds.includes(a.toObjectId)) {
          contactCallIds.push(a.toObjectId);
          console.log(`      Call ID: ${a.toObjectId} (only via contact)`);
        } else {
          console.log(`      Call ID: ${a.toObjectId} (also direct)`);
        }
      }
    }
  } catch (error) {
    console.error('  ERROR fetching contact-based calls:', error);
  }

  // 3c: Fetch all call details using our updated function
  console.log('\n  Using getCallsByDealId() (updated with contact path):');
  const calls = await getCallsByDealId(DEAL_ID);
  console.log(`  Total calls returned: ${calls.length}`);

  for (const call of calls) {
    const ts = call.properties.hs_timestamp ? new Date(call.properties.hs_timestamp) : null;
    const inWeek1 = ts ? (ts.getTime() >= createdDateMidnight.getTime() && ts.getTime() <= week1End.getTime()) : false;
    const marker = inWeek1 ? 'IN WEEK 1' : 'OUTSIDE WEEK 1';

    console.log(`\n    Call ID: ${call.id}`);
    console.log(`      Title: ${call.properties.hs_call_title || '(none)'}`);
    console.log(`      Timestamp: ${ts ? `${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}` : 'unknown'}`);
    console.log(`      Duration: ${call.properties.hs_call_duration || '0'}ms`);
    console.log(`      Disposition: ${call.properties.hs_call_disposition || '(none)'}`);
    console.log(`      --> ${marker}`);
  }

  // Step 4: Fetch emails
  console.log('\n--- Step 4: Fetch All Emails ---');

  const emails = await getEmailsByDealId(DEAL_ID);
  console.log(`  Total emails returned: ${emails.length}`);

  for (const email of emails) {
    const ts = email.timestamp ? new Date(email.timestamp) : null;
    const inWeek1 = ts ? (ts.getTime() >= createdDateMidnight.getTime() && ts.getTime() <= week1End.getTime()) : false;
    const isOutbound = email.direction === 'OUTGOING_EMAIL' ||
      (email.direction === 'EMAIL' && email.fromEmail?.endsWith('@opusbehavioral.com'));
    const marker = inWeek1 ? 'IN WEEK 1' : 'OUTSIDE WEEK 1';
    const dirMarker = isOutbound ? 'OUTBOUND' : email.direction || 'unknown';

    console.log(`\n    Email ID: ${email.id}`);
    console.log(`      Subject: ${email.subject}`);
    console.log(`      Direction: ${dirMarker}`);
    console.log(`      From: ${email.fromEmail || 'unknown'}`);
    console.log(`      Timestamp: ${ts ? `${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}` : 'unknown'}`);
    console.log(`      --> ${marker}`);
  }

  // Step 5: Week 1 analysis
  console.log('\n--- Step 5: Week 1 Touch Analysis ---');

  const week1 = analyzeWeek1Touches(calls, emails, createdAt, 6);
  console.log(`  Week 1 Calls: ${week1.touches.calls}`);
  console.log(`  Week 1 Emails: ${week1.touches.emails}`);
  console.log(`  Week 1 Total: ${week1.touches.total}`);
  console.log(`  Target: ${week1.target}`);
  console.log(`  Gap: ${week1.gap}`);
  console.log(`  Status: ${week1.status}`);

  // Step 6: All-time touches
  console.log('\n--- Step 6: All-Time Touches (Total Touches column) ---');

  const allTime = countTouchesInRange(calls, emails, new Date('2020-01-01'), new Date('2030-12-31'));
  console.log(`  All-time Calls: ${allTime.calls}`);
  console.log(`  All-time Outbound Emails: ${allTime.emails}`);
  console.log(`  All-time Total Touches: ${allTime.total}`);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Week 1 window: ${createdDateMidnight.toLocaleDateString()} - ${week1End.toLocaleDateString()}`);
  console.log(`  Week 1 touches: ${week1.touches.total} (${week1.touches.calls} calls + ${week1.touches.emails} emails)`);
  console.log(`  Total touches (all time): ${allTime.total} (${allTime.calls} calls + ${allTime.emails} emails)`);
  console.log(`  Dashboard should show: Wk 1 Calls=${week1.touches.calls}, Wk 1 Emails=${week1.touches.emails}, Total Touches=${allTime.total}`);
}

main().catch(console.error);
