import { config } from 'dotenv';
config({ path: '.env.local' });

import { writeFileSync } from 'fs';
import { getHubSpotClient } from '../lib/hubspot/client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CLOSED_WON_STAGE_ID = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';

interface Contact {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  jobTitle: string | null;
}

interface DealWithContacts {
  id: string;
  name: string;
  amount: number | null;
  closeDate: string | null;
  contacts: Contact[];
}

async function getContactsForDeal(client: ReturnType<typeof getHubSpotClient>, dealId: string): Promise<Contact[]> {
  const contacts: Contact[] = [];

  try {
    // Get associations using v4 API: deals -> contacts
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'contacts',
      undefined,
      100
    );

    if (associations.results.length === 0) {
      return contacts;
    }

    // Fetch each contact's details
    const contactIds = associations.results.map((a) => a.toObjectId);

    for (const contactId of contactIds) {
      try {
        const contact = await client.crm.contacts.basicApi.getById(
          contactId,
          ['email', 'firstname', 'lastname', 'phone', 'jobtitle']
        );

        contacts.push({
          id: contact.id,
          email: contact.properties.email || null,
          firstName: contact.properties.firstname || null,
          lastName: contact.properties.lastname || null,
          phone: contact.properties.phone || null,
          jobTitle: contact.properties.jobtitle || null,
        });
      } catch (error) {
        console.warn(`Failed to fetch contact ${contactId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to get contact associations for deal ${dealId}:`, error);
  }

  return contacts;
}

async function main() {
  console.log('Fetching Closed Won deals with associated contacts from HubSpot...\n');

  const client = getHubSpotClient();
  const deals: DealWithContacts[] = [];
  let after: string | undefined;

  // Step 1: Fetch all closed won deals
  console.log('Step 1: Fetching closed won deals...');
  do {
    const response = await client.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'pipeline',
              operator: FilterOperatorEnum.Eq,
              value: SALES_PIPELINE_ID,
            },
            {
              propertyName: 'dealstage',
              operator: FilterOperatorEnum.Eq,
              value: CLOSED_WON_STAGE_ID,
            },
          ],
        },
      ],
      properties: ['dealname', 'amount', 'closedate'],
      limit: 100,
      after: after ? after : undefined,
    });

    for (const deal of response.results) {
      deals.push({
        id: deal.id,
        name: deal.properties.dealname || 'Unknown',
        amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
        closeDate: deal.properties.closedate || null,
        contacts: [], // Will be populated in step 2
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  console.log(`Found ${deals.length} Closed Won deals\n`);

  // Step 2: Fetch contacts for each deal
  console.log('Step 2: Fetching associated contacts...');
  let totalContacts = 0;

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    process.stdout.write(`\r  Processing deal ${i + 1}/${deals.length}...`);
    deal.contacts = await getContactsForDeal(client, deal.id);
    totalContacts += deal.contacts.length;
  }
  console.log('\n');

  // Sort by close date descending (most recent first)
  deals.sort((a, b) => {
    if (!a.closeDate) return 1;
    if (!b.closeDate) return -1;
    return new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime();
  });

  // Output to console
  console.log('============================================================');
  console.log('CLOSED WON DEALS WITH ASSOCIATED CONTACTS');
  console.log('============================================================\n');

  for (const deal of deals) {
    const formattedAmount = deal.amount !== null
      ? `$${deal.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'N/A';
    const formattedDate = deal.closeDate ? deal.closeDate.split('T')[0] : 'N/A';

    console.log(`Deal: ${deal.name}`);
    console.log(`  Amount: ${formattedAmount}`);
    console.log(`  Close Date: ${formattedDate}`);
    console.log(`  Contacts (${deal.contacts.length}):`);

    if (deal.contacts.length === 0) {
      console.log('    - No associated contacts');
    } else {
      for (const contact of deal.contacts) {
        const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown';
        const email = contact.email || 'No email';
        const title = contact.jobTitle ? ` - ${contact.jobTitle}` : '';
        console.log(`    - ${name} (${email})${title}`);
      }
    }
    console.log('');
  }

  console.log('============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`Total closed won deals: ${deals.length}`);
  console.log(`Total associated contacts: ${totalContacts}`);

  // Build CSV
  const csvLines: string[] = ['Deal Name,Amount,Close Date,Contact Name,Contact Email,Contact Phone,Contact Title'];

  for (const deal of deals) {
    const escapeCsv = (value: string | null): string => {
      if (!value) return '';
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const dealName = escapeCsv(deal.name);
    const amount = deal.amount !== null ? deal.amount.toFixed(2) : '';
    const closeDate = deal.closeDate ? deal.closeDate.split('T')[0] : '';

    if (deal.contacts.length === 0) {
      // Include deal even if no contacts
      csvLines.push(`${dealName},${amount},${closeDate},,,,`);
    } else {
      for (const contact of deal.contacts) {
        const contactName = escapeCsv([contact.firstName, contact.lastName].filter(Boolean).join(' ') || '');
        const contactEmail = escapeCsv(contact.email);
        const contactPhone = escapeCsv(contact.phone);
        const contactTitle = escapeCsv(contact.jobTitle);

        csvLines.push(`${dealName},${amount},${closeDate},${contactName},${contactEmail},${contactPhone},${contactTitle}`);
      }
    }
  }

  const csvContent = csvLines.join('\n');
  const outputPath = './closed-won-deals-contacts.csv';

  writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`\nCSV exported to: ${outputPath}`);
}

main().catch(console.error);
