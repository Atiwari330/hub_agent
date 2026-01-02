import { getHubSpotClient } from './client';
import type { HubSpotNote } from '@/types/hubspot';

export async function getNotesByDealId(dealId: string): Promise<HubSpotNote[]> {
  const client = getHubSpotClient();
  const notes: HubSpotNote[] = [];

  try {
    // Get associations using v4 API: deals -> notes
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'notes',
      undefined,
      100
    );

    if (associations.results.length === 0) {
      return notes;
    }

    // Fetch each note's details
    const noteIds = associations.results.map((a) => a.toObjectId);

    for (const noteId of noteIds) {
      try {
        const note = await client.crm.objects.notes.basicApi.getById(
          noteId,
          ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id']
        );

        notes.push({
          id: note.id,
          properties: {
            hs_note_body: note.properties.hs_note_body,
            hs_timestamp: note.properties.hs_timestamp,
            hubspot_owner_id: note.properties.hubspot_owner_id,
          },
        });
      } catch (error) {
        // Skip notes that can't be fetched
        console.warn(`Failed to fetch note ${noteId}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to get associations for deal ${dealId}:`, error);
  }

  return notes;
}

export async function getEmailsByDealId(dealId: string): Promise<Array<{ id: string; subject: string; body: string }>> {
  const client = getHubSpotClient();
  const emails: Array<{ id: string; subject: string; body: string }> = [];

  try {
    // Get associations using v4 API: deals -> emails
    const associations = await client.crm.associations.v4.basicApi.getPage(
      'deals',
      dealId,
      'emails',
      undefined,
      10 // Limit to 10 emails
    );

    if (associations.results.length === 0) {
      return emails;
    }

    for (const assoc of associations.results) {
      try {
        const email = await client.crm.objects.emails.basicApi.getById(
          assoc.toObjectId,
          ['hs_email_subject', 'hs_email_text']
        );

        emails.push({
          id: email.id,
          subject: email.properties.hs_email_subject || '',
          body: email.properties.hs_email_text || '',
        });
      } catch {
        // Skip emails that can't be fetched
      }
    }
  } catch {
    // No email associations
  }

  return emails;
}
