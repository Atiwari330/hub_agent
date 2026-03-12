import { config } from 'dotenv';
config({ path: '.env.local' });
import { createServiceClient } from '../lib/supabase/client';

async function main() {
  const s = createServiceClient();
  const { data, error } = await s.from('ticket_sop_analyses').select('*').limit(1).single();
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}

main();
