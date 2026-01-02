import { getHubSpotClient } from '../lib/hubspot/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnoseCloseDates() {
  // Get some deals from database
  const { data: dbDeals, error } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, close_date')
    .not('hubspot_deal_id', 'is', null)
    .limit(5);

  if (error) {
    console.error('DB Error:', error);
    return;
  }

  console.log('=== CLOSE DATE COMPARISON ===\n');

  // For each deal, fetch from HubSpot and compare
  const client = getHubSpotClient();
  
  for (const dbDeal of dbDeals!) {
    try {
      const hubspotDeal = await client.crm.deals.basicApi.getById(
        dbDeal.hubspot_deal_id,
        ['dealname', 'closedate']
      );
      
      console.log('Deal:', dbDeal.deal_name);
      console.log('  HubSpot closedate raw:', hubspotDeal.properties.closedate);
      console.log('  Database close_date:', dbDeal.close_date);
      console.log('  Match:', hubspotDeal.properties.closedate?.substring(0,10) === dbDeal.close_date);
      console.log('');
    } catch (err: any) {
      console.log('Error fetching deal', dbDeal.hubspot_deal_id, err.message);
    }
  }
}

diagnoseCloseDates();
