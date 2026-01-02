import { getHubSpotClient } from '../lib/hubspot/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
  // Get a few deals with March 2026 close dates
  const { data: deals } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, close_date')
    .eq('close_date', '2026-03-31')
    .limit(3);

  console.log('=== VERIFYING MARCH 2026 DEALS IN HUBSPOT ===\n');

  const client = getHubSpotClient();
  
  for (const deal of deals || []) {
    try {
      const hubspotDeal = await client.crm.deals.basicApi.getById(
        deal.hubspot_deal_id,
        ['dealname', 'closedate', 'hs_closed_amount', 'hs_is_closed']
      );
      
      console.log('Deal:', deal.deal_name);
      console.log('  HubSpot closedate:', hubspotDeal.properties.closedate);
      console.log('  Database close_date:', deal.close_date);
      console.log('  HubSpot is_closed:', hubspotDeal.properties.hs_is_closed);
      console.log('');
    } catch (err: any) {
      console.log('Error:', deal.hubspot_deal_id, err.message);
    }
  }
}

verify();
