import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { getTargetOwners } from '@/lib/hubspot/owners';
import { getFilteredDealsForSync } from '@/lib/hubspot/deals';
import { getNotesByDealIdWithAuthor } from '@/lib/hubspot/engagements';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// Active stages for exception deal notes sync (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

// Convert empty strings to null for timestamp fields
// HubSpot returns "" for empty dates, but PostgreSQL needs null
const toTimestamp = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  // HubSpot sometimes returns epoch milliseconds as a string (e.g. "1702304200168")
  // PostgreSQL TIMESTAMP columns need ISO 8601 format
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
};

// Verify cron secret for security
function verifyCronSecret(request: Request): boolean {
  // Skip auth in development mode
  if (process.env.NODE_ENV === 'development') return true;

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return true; // Skip if not configured
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    const startTime = Date.now();

    // Log workflow start
    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'sync-hubspot',
      status: 'running',
    });

    // Step 1: Sync target AE owners only (4 parallel API calls)
    console.log(`Syncing ${SYNC_CONFIG.TARGET_AE_EMAILS.length} target AE owners from HubSpot...`);
    const owners = await getTargetOwners();

    // Batch upsert owners (single DB call instead of loop)
    const ownerData = owners.map((owner) => ({
      hubspot_owner_id: owner.id,
      email: owner.email,
      first_name: owner.firstName,
      last_name: owner.lastName,
      synced_at: new Date().toISOString(),
    }));

    const { error: ownerError } = await supabase
      .from('owners')
      .upsert(ownerData, { onConflict: 'hubspot_owner_id' });

    if (ownerError) {
      console.error('Owner batch upsert error:', ownerError);
    }

    console.log(`Synced ${owners.length} owners`);

    // Step 2: Get owner mapping for deals
    const { data: ownerRecords } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id');

    const ownerMap = new Map(
      ownerRecords?.map((o) => [o.hubspot_owner_id, o.id]) || []
    );

    // Step 3: Fetch filtered deals (only target AEs, Sales Pipeline, 2025+)
    const ownerIds = owners.map((o) => o.id);
    console.log(`Syncing deals for ${ownerIds.length} AEs (Sales Pipeline, 2025+)...`);

    const deals = await getFilteredDealsForSync(ownerIds);
    console.log(`Found ${deals.length} deals matching criteria`);

    // Step 4: Batch upsert deals (chunked for large datasets)
    // Use toTimestamp() to convert empty strings to null for all date fields
    const dealData = deals.map((deal) => ({
      hubspot_deal_id: deal.id,
      deal_name: deal.properties.dealname,
      amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
      close_date: toTimestamp(deal.properties.closedate),
      pipeline: deal.properties.pipeline,
      deal_stage: deal.properties.dealstage,
      description: deal.properties.description,
      owner_id: deal.properties.hubspot_owner_id
        ? ownerMap.get(deal.properties.hubspot_owner_id) ?? null
        : null,
      hubspot_owner_id: deal.properties.hubspot_owner_id,
      hubspot_created_at: toTimestamp(deal.properties.createdate),
      lead_source: deal.properties.lead_source,
      last_activity_date: toTimestamp(deal.properties.notes_last_updated),
      next_activity_date: toTimestamp(deal.properties.notes_next_activity_date),
      next_step: deal.properties.hs_next_step,
      products: deal.properties.product_s,
      deal_substage: deal.properties.proposal_stage,
      deal_collaborator: deal.properties.hs_all_collaborator_owner_ids,
      sql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.SQL.property]),
      demo_scheduled_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property]),
      demo_completed_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property]),
      closed_won_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.CLOSED_WON.property]),
      synced_at: new Date().toISOString(),
    }));

    // Chunk deals into batches for upsert
    let dealSuccess = 0;
    let dealErrors = 0;

    for (let i = 0; i < dealData.length; i += SYNC_CONFIG.DB_BATCH_SIZE) {
      const chunk = dealData.slice(i, i + SYNC_CONFIG.DB_BATCH_SIZE);
      const { error: dealError } = await supabase
        .from('deals')
        .upsert(chunk, { onConflict: 'hubspot_deal_id' });

      if (dealError) {
        console.error(`Deal batch upsert error (chunk ${i / SYNC_CONFIG.DB_BATCH_SIZE + 1}):`, dealError);
        dealErrors += chunk.length;
      } else {
        dealSuccess += chunk.length;
      }
    }

    // Step 4b: Clean up stale deals
    // Remove deals that are no longer in the target pipeline or have changed owners
    const syncedDealIds = deals.map((d) => d.id);
    const targetOwnerIds = Array.from(ownerMap.values());
    let dealsDeleted = 0;
    let dealsUnassigned = 0;

    // Delete deals not in the target pipeline (e.g., moved to Upsells)
    const { data: wrongPipelineDeals, error: wrongPipelineError } = await supabase
      .from('deals')
      .delete()
      .neq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .select('id');

    if (wrongPipelineError) {
      console.error('Error deleting wrong pipeline deals:', wrongPipelineError);
    } else {
      dealsDeleted = wrongPipelineDeals?.length || 0;
      if (dealsDeleted > 0) {
        console.log(`Deleted ${dealsDeleted} deals from non-target pipelines`);
      }
    }

    // Clear owner_id for deals owned by target AEs that weren't in sync batch
    // (These are deals where the owner was changed in HubSpot)
    if (syncedDealIds.length > 0) {
      const { data: orphanedDeals, error: orphanError } = await supabase
        .from('deals')
        .update({ owner_id: null, hubspot_owner_id: null })
        .in('owner_id', targetOwnerIds)
        .not('hubspot_deal_id', 'in', `(${syncedDealIds.join(',')})`)
        .select('id');

      if (orphanError) {
        console.error('Error clearing orphaned deal owners:', orphanError);
      } else {
        dealsUnassigned = orphanedDeals?.length || 0;
        if (dealsUnassigned > 0) {
          console.log(`Cleared owner from ${dealsUnassigned} deals (owner changed in HubSpot)`);
        }
      }
    }

    // Step 5: Sync notes for exception-eligible deals
    // Only sync for: target AEs, Sales Pipeline, 2025+ deals, active stages
    const today = new Date().toISOString().split('T')[0];
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const minDate = SYNC_CONFIG.MIN_DATE;

    const { data: exceptionDeals } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id')
      .in('owner_id', targetOwnerIds)                           // Only target AEs
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)           // Sales Pipeline only
      .in('deal_stage', ACTIVE_DEAL_STAGES)                     // Only active stages
      .gte('hubspot_created_at', minDate)                       // 2025+ deals only
      .or(`next_step_due_date.lt.${today},close_date.lt.${today},last_activity_date.lt.${tenDaysAgo}`)
      .order('amount', { ascending: false, nullsFirst: false })
      .limit(100);                                               // Safety limit

    console.log(`Syncing notes for ${exceptionDeals?.length || 0} exception-eligible deals...`);

    // Build owner name map once for all note lookups
    const ownerNameMap = new Map<string, string>();
    for (const owner of owners) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email;
      ownerNameMap.set(owner.id, name);
    }

    let notesSynced = 0;
    for (const deal of exceptionDeals || []) {
      try {
        const notes = await getNotesByDealIdWithAuthor(deal.hubspot_deal_id, ownerNameMap);

        // Only keep last 5 notes per deal
        const recentNotes = notes.slice(0, 5);

        for (const note of recentNotes) {
          const { error: noteError } = await supabase.from('deal_notes').upsert({
            hubspot_note_id: note.id,
            deal_id: deal.id,
            note_body: note.properties.hs_note_body,
            note_timestamp: note.properties.hs_timestamp,
            author_name: note.authorName,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'hubspot_note_id' });

          if (!noteError) {
            notesSynced++;
          }
        }
      } catch (error) {
        console.warn(`Failed to sync notes for deal ${deal.hubspot_deal_id}:`, error);
      }
    }

    console.log(`Synced ${notesSynced} notes for ${exceptionDeals?.length || 0} exception-eligible deals`);

    const duration = Date.now() - startTime;

    // Log success
    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        ownersSync: owners.length,
        dealsSync: dealSuccess,
        dealErrors,
        dealsDeleted,
        dealsUnassigned,
        notesSynced,
        exceptionDealsProcessed: exceptionDeals?.length || 0,
        durationMs: duration,
        filters: {
          targetAEs: SYNC_CONFIG.TARGET_AE_EMAILS,
          pipeline: SYNC_CONFIG.TARGET_PIPELINE_ID,
          minDate: SYNC_CONFIG.MIN_DATE,
        },
      },
    }).eq('id', workflowId);

    console.log(`Sync complete in ${duration}ms: ${owners.length} owners, ${dealSuccess} deals, ${dealsDeleted} deleted, ${dealsUnassigned} unassigned, ${notesSynced} notes`);

    return NextResponse.json({
      success: true,
      ownersSynced: owners.length,
      dealsSynced: dealSuccess,
      dealErrors,
      dealsDeleted,
      dealsUnassigned,
      notesSynced,
      exceptionDealsProcessed: exceptionDeals?.length || 0,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Sync failed:', error);

    // Log failure
    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
