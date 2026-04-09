import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { getTargetOwners } from '@/lib/hubspot/owners';
import { getFilteredDealsForSync, getUpsellDealsForSync, getDealById } from '@/lib/hubspot/deals';
import { getOwnerById } from '@/lib/hubspot/owners';
import { getNotesByDealIdWithAuthor } from '@/lib/hubspot/engagements';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { ACTIVE_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { validatePipelineStages } from '@/lib/hubspot/validate-stages';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { toTimestamp } from '@/lib/utils/timestamps';

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
      throw new Error(`Owner upsert failed: ${ownerError.message} — aborting to prevent deal corruption`);
    }

    console.log(`Synced ${owners.length} owners`);

    // Pipeline health check: detect unknown or removed stages
    const stageValidation = await validatePipelineStages();
    if (stageValidation.hasWarnings) {
      console.warn('Pipeline stage validation warnings detected — check workflow_runs result for details');
    }

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

    // Guard: If HubSpot returns zero deals for known AEs, likely an API issue
    if (deals.length === 0 && ownerIds.length > 0) {
      throw new Error('Zero deals returned from HubSpot for known AEs — possible API auth/filter issue');
    }

    // Step 4: Batch upsert deals (chunked for large datasets)
    // Use toTimestamp() to convert empty strings to null for all date fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dealData = deals.map((deal: any) => ({
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
      lead_source_detail: deal.properties.lead_source_detail,
      last_activity_date: toTimestamp(deal.properties.notes_last_updated),
      next_activity_date: toTimestamp(deal.properties.notes_next_activity_date),
      next_step: deal.properties.hs_next_step,
      products: deal.properties.product_s,
      deal_substage: deal.properties.proposal_stage,
      deal_collaborator: deal.properties.hs_all_collaborator_owner_ids,
      mql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.MQL.property]),
      sql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.SQL.property]),
      discovery_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DISCOVERY.property]),
      demo_scheduled_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property]),
      demo_completed_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property]),
      closed_won_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.CLOSED_WON.property]),
      proposal_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.PROPOSAL.property]),
      sent_gift_or_incentive: deal.properties.sent_gift_or_incentive === 'true',
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

    // Step 4a: Sync Upsell Pipeline deals (ALL owners, not just target AEs)
    console.log('Syncing Upsell Pipeline deals (all owners)...');
    const upsellDeals = await getUpsellDealsForSync();
    console.log(`Found ${upsellDeals.length} upsell deals matching criteria`);

    // Discover and sync any new owners from upsell deals
    const upsellOwnerIds = new Set<string>();
    for (const deal of upsellDeals) {
      if (deal.properties.hubspot_owner_id && !ownerMap.has(deal.properties.hubspot_owner_id)) {
        upsellOwnerIds.add(deal.properties.hubspot_owner_id);
      }
    }

    let upsellOwnersAdded = 0;
    if (upsellOwnerIds.size > 0) {
      console.log(`Discovering ${upsellOwnerIds.size} new owners from upsell deals...`);
      for (const hubspotOwnerId of upsellOwnerIds) {
        try {
          const owner = await getOwnerById(hubspotOwnerId);
          if (owner) {
            const { data: newOwner, error: ownerInsertError } = await supabase
              .from('owners')
              .upsert({
                hubspot_owner_id: owner.id,
                email: owner.email,
                first_name: owner.firstName,
                last_name: owner.lastName,
                synced_at: new Date().toISOString(),
              }, { onConflict: 'hubspot_owner_id' })
              .select('id, hubspot_owner_id')
              .single();

            if (!ownerInsertError && newOwner) {
              ownerMap.set(newOwner.hubspot_owner_id, newOwner.id);
              upsellOwnersAdded++;
            }
          }
        } catch (err) {
          console.warn(`Failed to fetch owner ${hubspotOwnerId}:`, err);
        }
      }
      console.log(`Added ${upsellOwnersAdded} new owners from upsell deals`);
    }

    // Map upsell deals to DB format and upsert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsellDealData = upsellDeals.map((deal: any) => ({
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
      lead_source_detail: deal.properties.lead_source_detail,
      last_activity_date: toTimestamp(deal.properties.notes_last_updated),
      next_activity_date: toTimestamp(deal.properties.notes_next_activity_date),
      next_step: deal.properties.hs_next_step,
      products: deal.properties.product_s,
      deal_substage: deal.properties.proposal_stage,
      deal_collaborator: deal.properties.hs_all_collaborator_owner_ids,
      mql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.MQL.property]),
      sql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.SQL.property]),
      discovery_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DISCOVERY.property]),
      demo_scheduled_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property]),
      demo_completed_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property]),
      closed_won_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.CLOSED_WON.property]),
      proposal_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.PROPOSAL.property]),
      sent_gift_or_incentive: deal.properties.sent_gift_or_incentive === 'true',
      synced_at: new Date().toISOString(),
    }));

    let upsellDealSuccess = 0;
    let upsellDealErrors = 0;

    for (let i = 0; i < upsellDealData.length; i += SYNC_CONFIG.DB_BATCH_SIZE) {
      const chunk = upsellDealData.slice(i, i + SYNC_CONFIG.DB_BATCH_SIZE);
      const { error: dealError } = await supabase
        .from('deals')
        .upsert(chunk, { onConflict: 'hubspot_deal_id' });

      if (dealError) {
        console.error(`Upsell deal batch upsert error (chunk ${i / SYNC_CONFIG.DB_BATCH_SIZE + 1}):`, dealError);
        upsellDealErrors += chunk.length;
      } else {
        upsellDealSuccess += chunk.length;
      }
    }

    console.log(`Synced ${upsellDealSuccess} upsell deals (${upsellDealErrors} errors)`);

    // Step 4b: Clean up stale deals
    // Remove deals that are not in any synced pipeline
    const targetOwnerIds = Array.from(ownerMap.values());
    let dealsDeleted = 0;
    let dealsUnassigned = 0;

    // Delete deals not in ANY of our synced pipelines (Sales or Upsells)
    // This handles deals moved to pipelines we don't track
    const { data: wrongPipelineDeals, error: wrongPipelineError } = await supabase
      .from('deals')
      .delete()
      .not('pipeline', 'in', `(${SYNC_CONFIG.ALL_PIPELINE_IDS.join(',')})`)
      .select('id');

    if (wrongPipelineError) {
      console.error('Error deleting wrong pipeline deals:', wrongPipelineError);
    } else {
      dealsDeleted = wrongPipelineDeals?.length || 0;
      if (dealsDeleted > 0) {
        console.log(`Deleted ${dealsDeleted} deals from non-tracked pipelines`);
      }
    }

    // Clear owner_id for Sales Pipeline deals owned by target AEs that weren't in sync batch
    // (These are deals where the owner was changed in HubSpot)
    // Note: We only do this for sales pipeline deals, not upsell deals
    const salesSyncedDealIds = deals.map((d) => d.id);
    if (salesSyncedDealIds.length > 0) {
      const { data: orphanedDeals, error: orphanError } = await supabase
        .from('deals')
        .update({ owner_id: null, hubspot_owner_id: null })
        .in('owner_id', targetOwnerIds)
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
        .not('hubspot_deal_id', 'in', `(${salesSyncedDealIds.join(',')})`)
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

    // Step 4c: Refresh orphaned deals still showing as active
    // Deals in the DB with active stages that weren't in the sync response may have
    // been reassigned or closed in HubSpot. Fetch their current state individually.
    let orphanDealsRefreshed = 0;

    const allSyncedDealIds = new Set([
      ...deals.map((d) => d.id),
      ...upsellDeals.map((d) => d.id),
    ]);

    // Find deals in active stages that weren't in any sync batch
    const { data: staleActiveDeals } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id, deal_name, deal_stage')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', [...ACTIVE_STAGE_IDS, '2030251']); // ACTIVE_STAGE_IDS + MQL

    const orphansToRefresh = (staleActiveDeals || []).filter(
      (d) => !allSyncedDealIds.has(d.hubspot_deal_id)
    );

    if (orphansToRefresh.length > 0) {
      console.log(`Refreshing ${orphansToRefresh.length} orphaned deals with stale active stages...`);

      for (const stale of orphansToRefresh) {
        try {
          const fresh = await getDealById(stale.hubspot_deal_id);
          if (!fresh) {
            // Deal was deleted in HubSpot — remove from DB
            await supabase.from('deals').delete().eq('id', stale.id);
            console.log(`  Deleted ${stale.deal_name} (removed from HubSpot)`);
            orphanDealsRefreshed++;
            continue;
          }

          // Update the deal with current HubSpot state
          // Cast properties to access dynamic stage tracking fields
          const props = fresh.properties as Record<string, string | undefined>;
          const updateData: Record<string, unknown> = {
            deal_name: fresh.properties.dealname,
            amount: fresh.properties.amount ? parseFloat(fresh.properties.amount) : null,
            close_date: toTimestamp(fresh.properties.closedate),
            pipeline: fresh.properties.pipeline,
            deal_stage: fresh.properties.dealstage,
            description: fresh.properties.description,
            hubspot_owner_id: fresh.properties.hubspot_owner_id,
            owner_id: fresh.properties.hubspot_owner_id
              ? ownerMap.get(fresh.properties.hubspot_owner_id) ?? null
              : null,
            hubspot_created_at: toTimestamp(fresh.properties.createdate),
            lead_source: fresh.properties.lead_source,
            lead_source_detail: props['lead_source_detail'],
            last_activity_date: toTimestamp(fresh.properties.notes_last_updated),
            next_activity_date: toTimestamp(fresh.properties.notes_next_activity_date),
            next_step: fresh.properties.hs_next_step,
            products: fresh.properties.product_s,
            deal_substage: fresh.properties.proposal_stage,
            deal_collaborator: fresh.properties.hs_all_collaborator_owner_ids,
            mql_entered_at: toTimestamp(props[TRACKED_STAGES.MQL.property]),
            sql_entered_at: toTimestamp(props[TRACKED_STAGES.SQL.property]),
            discovery_entered_at: toTimestamp(props[TRACKED_STAGES.DISCOVERY.property]),
            demo_scheduled_entered_at: toTimestamp(props[TRACKED_STAGES.DEMO_SCHEDULED.property]),
            demo_completed_entered_at: toTimestamp(props[TRACKED_STAGES.DEMO_COMPLETED.property]),
            closed_won_entered_at: toTimestamp(props[TRACKED_STAGES.CLOSED_WON.property]),
            proposal_entered_at: toTimestamp(props[TRACKED_STAGES.PROPOSAL.property]),
            synced_at: new Date().toISOString(),
          };

          // If deal moved to a different pipeline, let it be cleaned up by the pipeline cleanup step next run
          const { error: updateError } = await supabase
            .from('deals')
            .update(updateData)
            .eq('id', stale.id);

          if (!updateError) {
            orphanDealsRefreshed++;
            if (fresh.properties.dealstage !== stale.deal_stage) {
              console.log(`  Updated ${stale.deal_name}: stage changed from DB to HubSpot current`);
            }
          }
        } catch (err) {
          console.warn(`  Failed to refresh orphan deal ${stale.hubspot_deal_id}:`, err);
        }
      }

      console.log(`Refreshed ${orphanDealsRefreshed} orphaned deals`);
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
      .in('deal_stage', ACTIVE_STAGE_IDS)                     // Only active stages
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
        upsellOwnersAdded,
        dealsSync: dealSuccess,
        upsellDealsSync: upsellDealSuccess,
        dealErrors,
        upsellDealErrors,
        dealsDeleted,
        dealsUnassigned,
        orphanDealsRefreshed,
        notesSynced,
        exceptionDealsProcessed: exceptionDeals?.length || 0,
        durationMs: duration,
        stageWarnings: stageValidation,
        filters: {
          targetAEs: SYNC_CONFIG.TARGET_AE_EMAILS,
          salesPipeline: SYNC_CONFIG.TARGET_PIPELINE_ID,
          upsellPipeline: SYNC_CONFIG.UPSELL_PIPELINE_ID,
          minDate: SYNC_CONFIG.MIN_DATE,
        },
      },
    }).eq('id', workflowId);

    console.log(`Sync complete in ${duration}ms: ${owners.length} owners (+${upsellOwnersAdded} from upsells), ${dealSuccess} sales deals, ${upsellDealSuccess} upsell deals, ${dealsDeleted} deleted, ${dealsUnassigned} unassigned, ${orphanDealsRefreshed} orphans refreshed, ${notesSynced} notes`);

    return NextResponse.json({
      success: true,
      ownersSynced: owners.length,
      upsellOwnersAdded,
      salesDealsSynced: dealSuccess,
      upsellDealsSynced: upsellDealSuccess,
      dealErrors,
      upsellDealErrors,
      dealsDeleted,
      dealsUnassigned,
      orphanDealsRefreshed,
      notesSynced,
      exceptionDealsProcessed: exceptionDeals?.length || 0,
      stageWarnings: stageValidation,
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
