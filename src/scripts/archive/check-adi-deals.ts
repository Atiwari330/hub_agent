import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Get Adi's owner ID
  const { data: adi } = await supabase
    .from('owners')
    .select('id, email, first_name, last_name')
    .ilike('email', '%atiwari%')
    .single();

  console.log('Adi owner:', adi);

  if (adi) {
    // Get Adi's deals
    const { data: deals } = await supabase
      .from('deals')
      .select('deal_name, close_date, hubspot_deal_id')
      .eq('owner_id', adi.id)
      .limit(10);

    console.log('\nAdi deals:');
    deals?.forEach(d => console.log('-', d.deal_name, '|', d.close_date, '|', d.hubspot_deal_id));
  }

  // Also check for any 2026 dates
  const { data: future } = await supabase
    .from('deals')
    .select('deal_name, close_date')
    .gte('close_date', '2026-01-01');

  console.log('\n2026+ close dates:', future?.length || 0);
  future?.slice(0,5).forEach(d => console.log('-', d.deal_name, '|', d.close_date));
}

check();
