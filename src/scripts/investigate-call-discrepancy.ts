/**
 * Investigation Script: SPIFF Call Count Discrepancy (181 vs 154)
 *
 * Our SPIFF email reports 181 calls for Amos Boyd (Feb 2–8, 2026).
 * The HubSpot native dashboard reports 154.
 *
 * HubSpot dashboard filters:
 * 1. Phone number is known (contact must have a phone)
 * 2. Activity assigned to is any of 5 AEs
 * 3. Contact owner is any of 5 AEs
 * 4. Activity date is last week
 *
 * This script applies each filter progressively to find which produces 154.
 *
 * Run with: npx tsx src/scripts/investigate-call-discrepancy.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';
import { fetchCallsByOwner } from '../lib/hubspot/calls';
import { getOwnerByEmail, listAllOwners } from '../lib/hubspot/owners';

// The 5 AEs on the HubSpot dashboard filter
const DASHBOARD_AE_NAMES = [
  'Esteban Soruco',
  'Zachary Claussen',
  'Amos Boyd',
  'Jack Rice',
  'Christopher Garraffa',
];

const AMOS_EMAIL = 'aboyd@opusbehavioral.com';

/**
 * Batch fetch associations for calls → contacts, with chunking for >100 calls
 */
async function fetchContactAssociationsBatched(
  callIds: string[]
): Promise<Map<string, string[]>> {
  const client = getHubSpotClient();
  const result = new Map<string, string[]>();

  // Initialize empty
  for (const id of callIds) {
    result.set(id, []);
  }

  if (callIds.length === 0) return result;

  // Chunk into batches of 100 (HubSpot batch limit)
  const CHUNK_SIZE = 100;
  for (let i = 0; i < callIds.length; i += CHUNK_SIZE) {
    const chunk = callIds.slice(i, i + CHUNK_SIZE);

    const response = await client.crm.associations.batchApi.read(
      'calls',
      'contacts',
      { inputs: chunk.map((id) => ({ id })) }
    );

    for (const assoc of response.results) {
      const callId = assoc._from.id;
      const contactIds = assoc.to.map((t) => t.id);
      result.set(callId, contactIds);
    }
  }

  return result;
}

/**
 * Batch fetch contact details (phone fields + hubspot_owner_id) with chunking
 */
async function fetchContactDetails(
  contactIds: string[]
): Promise<Map<string, { phone: string | null; mobilephone: string | null; calculatedPhone: string | null; ownerId: string | null }>> {
  const client = getHubSpotClient();
  const result = new Map<string, { phone: string | null; mobilephone: string | null; calculatedPhone: string | null; ownerId: string | null }>();

  if (contactIds.length === 0) return result;

  const CHUNK_SIZE = 100;
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE);

    const response = await client.crm.contacts.batchApi.read({
      inputs: chunk.map((id) => ({ id })),
      properties: ['phone', 'mobilephone', 'hs_calculated_phone_number', 'hubspot_owner_id'],
      propertiesWithHistory: [],
    });

    for (const contact of response.results) {
      result.set(contact.id, {
        phone: contact.properties.phone || null,
        mobilephone: contact.properties.mobilephone || null,
        calculatedPhone: contact.properties.hs_calculated_phone_number || null,
        ownerId: contact.properties.hubspot_owner_id || null,
      });
    }
  }

  return result;
}

async function main() {
  console.log('='.repeat(70));
  console.log('INVESTIGATION: Call Count Discrepancy (181 vs 154)');
  console.log('='.repeat(70));

  // ── Step 1: Resolve owner IDs ───────────────────────────────────────

  console.log('\n── Step 1: Resolve Dashboard AE Owner IDs ──');
  const allOwners = await listAllOwners();

  const dashboardAeIds = new Set<string>();
  for (const aeName of DASHBOARD_AE_NAMES) {
    const [first, last] = aeName.split(' ');
    const match = allOwners.find(
      (o) =>
        o.firstName?.toLowerCase() === first.toLowerCase() &&
        o.lastName?.toLowerCase() === last.toLowerCase()
    );
    if (match) {
      dashboardAeIds.add(match.id);
      console.log(`  ${aeName} → Owner ID: ${match.id}`);
    } else {
      console.log(`  ${aeName} → NOT FOUND`);
    }
  }

  const amos = await getOwnerByEmail(AMOS_EMAIL);
  if (!amos) {
    console.error('Could not find Amos by email');
    return;
  }
  console.log(`\n  Amos Owner ID: ${amos.id}`);

  // ── Step 2: Fetch all calls for Amos, Feb 2–8 ─────────────────────

  console.log('\n── Step 2: Fetch All Calls (Feb 2–8) ──');
  const weekStart = new Date('2026-02-02T00:00:00-05:00');
  const weekEnd = new Date('2026-02-08T23:59:59.999-05:00');

  const allCalls = await fetchCallsByOwner(amos.id, weekStart, weekEnd);
  console.log(`  Total calls: ${allCalls.length}`);

  if (allCalls.length === 0) {
    console.log('  No calls found — nothing to investigate.');
    return;
  }

  // ── Step 3: Fetch contact associations ─────────────────────────────

  console.log('\n── Step 3: Fetch Contact Associations ──');
  const callIds = allCalls.map((c) => c.id);
  const callContactMap = await fetchContactAssociationsBatched(callIds);

  // Count calls with/without contacts
  let callsWithContact = 0;
  let callsWithoutContact = 0;
  const allContactIds = new Set<string>();

  for (const [, contactIds] of callContactMap) {
    if (contactIds.length > 0) {
      callsWithContact++;
      for (const cid of contactIds) allContactIds.add(cid);
    } else {
      callsWithoutContact++;
    }
  }

  console.log(`  Calls WITH at least 1 contact: ${callsWithContact}`);
  console.log(`  Calls WITHOUT any contact: ${callsWithoutContact}`);
  console.log(`  Unique contacts referenced: ${allContactIds.size}`);

  // ── Step 4: Fetch contact details ──────────────────────────────────

  console.log('\n── Step 4: Fetch Contact Details (phone, owner) ──');
  const contactDetails = await fetchContactDetails(Array.from(allContactIds));
  console.log(`  Fetched details for ${contactDetails.size} contacts`);

  // ── Step 5: Apply progressive filters ──────────────────────────────

  console.log('\n── Step 5: Progressive Filter Results ──');
  console.log(`  Total (no filter): ${allCalls.length}`);

  // Filter A: call has at least 1 associated contact
  const filterA = allCalls.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.length > 0;
  });
  console.log(`  Filter A (has contact): ${filterA.length}`);

  // Helper: does a contact have any phone number?
  const hasAnyPhone = (cid: string): boolean => {
    const detail = contactDetails.get(cid);
    if (!detail) return false;
    return (
      (detail.phone != null && detail.phone.trim() !== '') ||
      (detail.mobilephone != null && detail.mobilephone.trim() !== '') ||
      (detail.calculatedPhone != null && detail.calculatedPhone.trim() !== '')
    );
  };

  // Filter B: A + at least one contact has a phone number (any phone field)
  const filterB = filterA.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.some((cid) => hasAnyPhone(cid));
  });
  console.log(`  Filter B (A + contact has any phone): ${filterB.length}`);

  // Filter B2: A + contact has specifically the `phone` property
  const filterB2 = filterA.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.some((cid) => {
      const detail = contactDetails.get(cid);
      return detail?.phone != null && detail.phone.trim() !== '';
    });
  });
  console.log(`  Filter B2 (A + contact has phone prop only): ${filterB2.length}`);

  // Filter C: A + at least one contact's owner is in the 5 AE set
  const filterC = filterA.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.some((cid) => {
      const detail = contactDetails.get(cid);
      return detail?.ownerId != null && dashboardAeIds.has(detail.ownerId);
    });
  });
  console.log(`  Filter C (A + contact owner in AE set): ${filterC.length}`);

  // Filter D: B + C combined (any phone AND contact owner in AE set, same contact)
  const filterD = filterA.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.some((cid) => {
      const detail = contactDetails.get(cid);
      return (
        hasAnyPhone(cid) &&
        detail?.ownerId != null &&
        dashboardAeIds.has(detail.ownerId)
      );
    });
  });
  console.log(`  Filter D (A + any phone + AE owner, same contact): ${filterD.length}`);

  // Filter E: like D but any contact meets phone, any contact meets owner (not same contact)
  const filterE = filterA.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    const contactHasPhone = contacts.some((cid) => hasAnyPhone(cid));
    const hasAeOwner = contacts.some((cid) => {
      const detail = contactDetails.get(cid);
      return detail?.ownerId != null && dashboardAeIds.has(detail.ownerId);
    });
    return contactHasPhone && hasAeOwner;
  });
  console.log(`  Filter E (A + any has phone + any has AE owner): ${filterE.length}`);

  // ── Highlight matches ──────────────────────────────────────────────

  console.log('\n── MATCH CHECK ──');
  const TARGET = 154;
  const filters = [
    { name: 'A (has contact)', count: filterA.length },
    { name: 'B (A + any phone field)', count: filterB.length },
    { name: 'B2 (A + phone prop only)', count: filterB2.length },
    { name: 'C (A + AE owner)', count: filterC.length },
    { name: 'D (A + any phone + AE owner, same contact)', count: filterD.length },
    { name: 'E (A + any phone + any AE owner)', count: filterE.length },
  ];

  for (const f of filters) {
    const marker = f.count === TARGET ? ' <<<< MATCH!' : '';
    console.log(`  ${f.name}: ${f.count}${marker}`);
  }

  // ── Step 6: Print excluded calls for spot-checking ─────────────────

  console.log('\n── Step 6: Excluded Calls (not passing Filter A) ──');
  const excluded = allCalls.filter((call) => {
    const contacts = callContactMap.get(call.id) || [];
    return contacts.length === 0;
  });

  for (const call of excluded.slice(0, 20)) {
    const ts = call.timestamp.toLocaleString('en-US', {
      timeZone: 'America/New_York',
    });
    console.log(
      `  Call ${call.id} | ${ts} | ${call.title || '(no title)'} | https://app.hubspot.com/contacts/7358632/record/0-48/${call.id}/`
    );
  }
  if (excluded.length > 20) {
    console.log(`  ... and ${excluded.length - 20} more`);
  }

  // Also show calls that pass A but fail the best-matching filter
  const bestFilter = filters.reduce((best, f) =>
    Math.abs(f.count - TARGET) < Math.abs(best.count - TARGET) ? f : best
  );
  console.log(`\n  Closest filter: ${bestFilter.name} = ${bestFilter.count}`);

  if (bestFilter.count !== TARGET) {
    console.log(
      `\n  No exact match found. Closest is off by ${Math.abs(bestFilter.count - TARGET)}.`
    );
    console.log('  Consider checking if HubSpot also filters by call disposition or other property.');
  }

  // ── Contact owner distribution ─────────────────────────────────────

  console.log('\n── Contact Owner Distribution ──');
  const ownerCounts = new Map<string, number>();
  for (const [, detail] of contactDetails) {
    const oid = detail.ownerId || '(none)';
    ownerCounts.set(oid, (ownerCounts.get(oid) || 0) + 1);
  }
  const sortedOwners = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [oid, count] of sortedOwners.slice(0, 15)) {
    const isAe = dashboardAeIds.has(oid) ? ' [AE]' : '';
    const ownerInfo = allOwners.find((o) => o.id === oid);
    const name = ownerInfo
      ? `${ownerInfo.firstName} ${ownerInfo.lastName}`
      : oid;
    console.log(`  ${name}: ${count} contacts${isAe}`);
  }
}

main().catch(console.error);
