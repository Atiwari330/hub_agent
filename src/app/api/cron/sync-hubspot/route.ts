import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { listAllOwners } from '@/lib/hubspot/owners';
import { getAllDeals } from '@/lib/hubspot/deals';

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
    // Log workflow start
    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'sync-hubspot',
      status: 'running',
    });

    // Sync owners
    console.log('Syncing owners from HubSpot...');
    const owners = await listAllOwners();

    for (const owner of owners) {
      await supabase.from('owners').upsert({
        hubspot_owner_id: owner.id,
        email: owner.email,
        first_name: owner.firstName,
        last_name: owner.lastName,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'hubspot_owner_id',
      });
    }

    // Get owner mapping for deals
    const { data: ownerRecords } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id');

    const ownerMap = new Map(
      ownerRecords?.map((o) => [o.hubspot_owner_id, o.id]) || []
    );

    // Sync deals
    console.log('Syncing deals from HubSpot...');
    const deals = await getAllDeals();

    for (const deal of deals) {
      await supabase.from('deals').upsert({
        hubspot_deal_id: deal.id,
        deal_name: deal.properties.dealname,
        amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
        close_date: deal.properties.closedate,
        pipeline: deal.properties.pipeline,
        deal_stage: deal.properties.dealstage,
        description: deal.properties.description,
        owner_id: deal.properties.hubspot_owner_id
          ? ownerMap.get(deal.properties.hubspot_owner_id)
          : null,
        hubspot_owner_id: deal.properties.hubspot_owner_id,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'hubspot_deal_id',
      });
    }

    // Log success
    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        ownersSync: owners.length,
        dealsSync: deals.length,
      },
    }).eq('id', workflowId);

    console.log(`Sync complete: ${owners.length} owners, ${deals.length} deals`);

    return NextResponse.json({
      success: true,
      ownersSynced: owners.length,
      dealsSynced: deals.length,
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
