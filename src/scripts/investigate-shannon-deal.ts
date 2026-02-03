/**
 * Diagnostic script to investigate missing email association for deal 54430899074
 * Target: Deal "Shannon Bumgardner -" (ID: 54430899074)
 * Expected: Find email from Christopher Garraffa dated Jan 23, 2026
 *
 * Run with: npx tsx src/scripts/investigate-shannon-deal.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getHubSpotClient } from '../lib/hubspot/client';
import { getEmailsByDealId, getCallsByDealId } from '../lib/hubspot/engagements';
import { countTouchesInRange } from '../lib/utils/touch-counter';

const DEAL_ID = '54430899074'; // Shannon Bumgardner -

async function main() {
  const client = getHubSpotClient();

  console.log('='.repeat(70));
  console.log('INVESTIGATION: Missing Email Association for Deal 54430899074');
  console.log('Deal Name: Shannon Bumgardner -');
  console.log('Expected: Email from Christopher Garraffa dated Jan 23, 2026');
  console.log('='.repeat(70));

  // Step 0: Fetch deal details
  console.log('\n📋 Step 0: Deal Details');
  console.log('-'.repeat(50));

  try {
    const deal = await client.crm.deals.basicApi.getById(DEAL_ID, [
      'dealname',
      'createdate',
      'hubspot_owner_id',
      'dealstage',
      'amount',
    ]);

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

  // Step 1: Direct deal → emails associations
  console.log('\n📧 Step 1: Deal → Emails (direct associations)');
  console.log('-'.repeat(50));

  let directEmailIds: string[] = [];
  try {
    const dealEmails = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      DEAL_ID,
      'emails',
      undefined,
      100 // Higher limit to ensure we get all
    );

    directEmailIds = dealEmails.results.map((a) => a.toObjectId);
    console.log(`  Found ${dealEmails.results.length} direct email associations`);
    for (const assoc of dealEmails.results) {
      console.log(`    Email ID: ${assoc.toObjectId}`);
    }

    if (directEmailIds.length === 0) {
      console.log('  ⚠️  NO direct email associations found on deal');
    }
  } catch (error) {
    console.error('  ERROR fetching deal→email associations:', error);
  }

  // Step 2: Deal → Contacts associations
  console.log('\n👤 Step 2: Deal → Contacts');
  console.log('-'.repeat(50));

  let contactIds: string[] = [];
  try {
    const contactAssocs = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      DEAL_ID,
      'contacts',
      undefined,
      50
    );

    contactIds = contactAssocs.results.map((a) => a.toObjectId);
    console.log(`  Found ${contactIds.length} associated contacts`);

    // Fetch contact details
    for (const contactId of contactIds) {
      try {
        const contact = await client.crm.contacts.basicApi.getById(contactId, [
          'firstname',
          'lastname',
          'email',
        ]);
        console.log(
          `    Contact ${contactId}: ${contact.properties.firstname || ''} ${contact.properties.lastname || ''} <${contact.properties.email || 'no email'}>`
        );
      } catch {
        console.log(`    Contact ${contactId}: (could not fetch details)`);
      }
    }

    if (contactIds.length === 0) {
      console.log('  ⚠️  NO contacts associated with deal!');
      console.log('  ❌ This could be the root cause - emails may be associated with contacts, not deal directly');
    }
  } catch (error) {
    console.error('  ERROR fetching deal→contact associations:', error);
  }

  // Step 3: For each contact, fetch contact → emails associations
  console.log('\n📬 Step 3: Contact → Emails (per contact)');
  console.log('-'.repeat(50));

  const contactEmailIds = new Set<string>();

  for (const contactId of contactIds) {
    try {
      const contactEmails = await client.crm.associations.v4.basicApi.getPage(
        'contacts',
        contactId,
        'emails',
        undefined,
        100 // Higher limit
      );

      console.log(`\n  Contact ${contactId}: ${contactEmails.results.length} email associations`);
      for (const assoc of contactEmails.results) {
        console.log(`    Email ID: ${assoc.toObjectId}`);
        contactEmailIds.add(assoc.toObjectId);
      }
    } catch (error) {
      console.error(`  ERROR fetching contact ${contactId} → emails:`, error);
    }
  }

  // Combine all unique email IDs
  const allEmailIds = new Set([...directEmailIds, ...contactEmailIds]);
  console.log(`\n  📊 Summary: ${allEmailIds.size} unique emails discovered`);
  console.log(`     - Direct from deal: ${directEmailIds.length}`);
  console.log(`     - Via contacts: ${contactEmailIds.size}`);

  // Step 4: Fetch details for ALL discovered emails
  console.log('\n📝 Step 4: Email Details');
  console.log('-'.repeat(50));

  const emails: Array<{
    id: string;
    subject: string;
    direction: string;
    from: string;
    timestamp: string;
    source: string;
  }> = [];

  for (const emailId of allEmailIds) {
    try {
      const email = await client.crm.objects.emails.basicApi.getById(emailId, [
        'hs_email_subject',
        'hs_email_direction',
        'hs_timestamp',
        'hs_email_from_email',
        'hs_email_to_email',
        'hs_email_status',
      ]);

      const ts = email.properties.hs_timestamp
        ? new Date(email.properties.hs_timestamp).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'unknown';

      const direction = email.properties.hs_email_direction || 'unknown';
      const fromDirect = directEmailIds.includes(emailId);
      const fromContact = contactEmailIds.has(emailId);
      const source = fromDirect && fromContact ? 'both' : fromDirect ? 'deal' : 'contact';

      emails.push({
        id: emailId,
        subject: email.properties.hs_email_subject || '(no subject)',
        direction,
        from: email.properties.hs_email_from_email || 'unknown',
        timestamp: ts,
        source,
      });

      const isOutbound = direction === 'OUTGOING_EMAIL';
      const marker = isOutbound ? '✅ OUTBOUND' : '❌ ' + direction;

      console.log(`\n  Email ID: ${emailId} [via ${source}]`);
      console.log(`    Subject: ${email.properties.hs_email_subject || '(no subject)'}`);
      console.log(`    Direction: ${marker}`);
      console.log(`    From: ${email.properties.hs_email_from_email || 'unknown'}`);
      console.log(`    To: ${email.properties.hs_email_to_email || 'unknown'}`);
      console.log(`    Timestamp: ${ts}`);
      console.log(`    Status: ${email.properties.hs_email_status || 'unknown'}`);
    } catch (error) {
      console.error(`  ERROR fetching email ${emailId}:`, error);
    }
  }

  // Step 5: Search for emails from Christopher Garraffa around Jan 23, 2026
  console.log('\n🔍 Step 5: Search for Jan 23, 2026 emails from Christopher Garraffa');
  console.log('-'.repeat(50));

  const jan23Emails = emails.filter((e) => {
    const isJan2026 = e.timestamp.includes('Jan') && e.timestamp.includes('2026');
    const isChris = e.from.toLowerCase().includes('cgarraffa') || e.from.toLowerCase().includes('chris');
    return isJan2026 || isChris;
  });

  if (jan23Emails.length > 0) {
    console.log(`  Found ${jan23Emails.length} potential matches:`);
    for (const email of jan23Emails) {
      console.log(`    - ${email.timestamp}: "${email.subject}" from ${email.from} (${email.direction})`);
    }
  } else {
    console.log('  ⚠️  No emails found matching Jan 2026 or from Christopher Garraffa');
    console.log('  This suggests the email may not be associated with the deal or contacts at all');
  }

  // Step 6: Test what the existing getEmailsByDealId function returns
  console.log('\n🧪 Step 6: Test existing getEmailsByDealId() function');
  console.log('-'.repeat(50));

  try {
    const functionEmails = await getEmailsByDealId(DEAL_ID);
    console.log(`  getEmailsByDealId returned ${functionEmails.length} emails:`);

    for (const email of functionEmails) {
      const isOutbound = email.direction === 'OUTGOING_EMAIL';
      const marker = isOutbound ? '✅' : '❌';
      console.log(`    ${marker} ${email.timestamp ? new Date(email.timestamp).toLocaleDateString() : 'no date'}: "${email.subject}" (${email.direction})`);
    }

    const outboundCount = functionEmails.filter((e) => e.direction === 'OUTGOING_EMAIL').length;
    console.log(`\n  📊 Outbound emails (what UI shows): ${outboundCount}`);
  } catch (error) {
    console.error('  ERROR in getEmailsByDealId:', error);
  }

  // Step 7: Test full touch counter
  console.log('\n📊 Step 7: Full Touch Count Analysis');
  console.log('-'.repeat(50));

  try {
    const [emails, calls] = await Promise.all([getEmailsByDealId(DEAL_ID), getCallsByDealId(DEAL_ID)]);

    // Count all touches (past year for wide range)
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2026-12-31');

    const touches = countTouchesInRange(calls, emails, startDate, endDate);

    console.log(`  Calls found: ${calls.length}`);
    console.log(`  Emails found: ${emails.length}`);
    console.log(`  Outbound emails: ${touches.emails}`);
    console.log(`  Total touches: ${touches.total}`);
  } catch (error) {
    console.error('  ERROR in touch analysis:', error);
  }

  // Final Summary
  console.log('\n' + '='.repeat(70));
  console.log('📋 INVESTIGATION SUMMARY');
  console.log('='.repeat(70));

  console.log('\n  Association Chain Analysis:');
  console.log(`    - Direct deal→emails: ${directEmailIds.length}`);
  console.log(`    - Deal→contacts: ${contactIds.length}`);
  console.log(`    - Contact→emails: ${contactEmailIds.size}`);
  console.log(`    - Total unique emails: ${allEmailIds.size}`);

  const outboundEmails = emails.filter((e) => e.direction === 'OUTGOING_EMAIL');
  console.log(`\n  Outbound Email Analysis:`);
  console.log(`    - Total outbound: ${outboundEmails.length}`);

  if (allEmailIds.size === 0) {
    console.log('\n  ❌ ROOT CAUSE: No email associations found at all');
    console.log('     The Jan 23 email is likely NOT associated with this deal or its contacts in HubSpot');
  } else if (outboundEmails.length === 0) {
    console.log('\n  ⚠️  POTENTIAL CAUSE: Emails exist but none are marked as OUTGOING_EMAIL');
    console.log('     Check the hs_email_direction field in HubSpot for these emails');
  } else {
    console.log('\n  ✅ Outbound emails found - check if Jan 23 email is among them');
  }

  console.log('\n  Next Steps:');
  console.log('    1. Verify in HubSpot UI that the Jan 23 email is associated with this deal');
  console.log('    2. Check if email is associated with a different contact not linked to deal');
  console.log('    3. Check if email was logged after deal was created (timing issue)');
}

main().catch(console.error);
