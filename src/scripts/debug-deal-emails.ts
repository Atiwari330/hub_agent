/**
 * Debug script to investigate email associations for a deal
 * Checks both deal-level and contact-level email associations
 * Run with: npx tsx src/scripts/debug-deal-emails.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getHubSpotClient } from '../lib/hubspot/client';

const DEAL_ID = '45327246117'; // Life By Design, PA - Software Advice

async function main() {
  const client = getHubSpotClient();

  console.log(`Debugging email associations for deal ${DEAL_ID}\n`);

  // Step 1: Direct deal → emails associations
  console.log('='.repeat(60));
  console.log('Step 1: Deal → Emails (direct associations)');
  console.log('='.repeat(60));

  try {
    const dealEmails = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      DEAL_ID,
      'emails',
      undefined,
      50
    );

    console.log(`Found ${dealEmails.results.length} direct email associations`);
    for (const assoc of dealEmails.results) {
      console.log(`  Email ID: ${assoc.toObjectId}`);
    }
  } catch (error) {
    console.error('Error fetching deal→email associations:', error);
  }

  // Step 2: Deal → Contacts associations
  console.log('\n' + '='.repeat(60));
  console.log('Step 2: Deal → Contacts');
  console.log('='.repeat(60));

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
    console.log(`Found ${contactIds.length} associated contacts: ${contactIds.join(', ')}`);

    // Fetch contact names
    for (const contactId of contactIds) {
      try {
        const contact = await client.crm.contacts.basicApi.getById(contactId, [
          'firstname',
          'lastname',
          'email',
        ]);
        console.log(
          `  Contact ${contactId}: ${contact.properties.firstname} ${contact.properties.lastname} (${contact.properties.email})`
        );
      } catch {
        console.log(`  Contact ${contactId}: (could not fetch details)`);
      }
    }
  } catch (error) {
    console.error('Error fetching deal→contact associations:', error);
  }

  // Step 3: For each contact, fetch contact → emails associations
  console.log('\n' + '='.repeat(60));
  console.log('Step 3: Contact → Emails (per contact)');
  console.log('='.repeat(60));

  const allEmailIds = new Set<string>();

  for (const contactId of contactIds) {
    try {
      const contactEmails = await client.crm.associations.v4.basicApi.getPage(
        'contacts',
        contactId,
        'emails',
        undefined,
        50
      );

      console.log(`\n  Contact ${contactId}: ${contactEmails.results.length} email associations`);
      for (const assoc of contactEmails.results) {
        console.log(`    Email ID: ${assoc.toObjectId}`);
        allEmailIds.add(assoc.toObjectId);
      }
    } catch (error) {
      console.error(`  Error fetching contact ${contactId} → emails:`, error);
    }
  }

  // Step 4: Fetch details for all discovered emails
  console.log('\n' + '='.repeat(60));
  console.log(`Step 4: Email details (${allEmailIds.size} unique emails found via contacts)`);
  console.log('='.repeat(60));

  for (const emailId of allEmailIds) {
    try {
      const email = await client.crm.objects.emails.basicApi.getById(emailId, [
        'hs_email_subject',
        'hs_email_direction',
        'hs_timestamp',
        'hs_email_from_email',
      ]);

      const ts = email.properties.hs_timestamp
        ? new Date(email.properties.hs_timestamp).toISOString()
        : 'unknown';

      console.log(`\n  Email ID: ${emailId}`);
      console.log(`    Subject: ${email.properties.hs_email_subject || '(no subject)'}`);
      console.log(`    Direction: ${email.properties.hs_email_direction || 'unknown'}`);
      console.log(`    From: ${email.properties.hs_email_from_email || 'unknown'}`);
      console.log(`    Timestamp: ${ts}`);
    } catch (error) {
      console.error(`  Error fetching email ${emailId}:`, error);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done.');
}

main();
