import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const Q2_START = '2026-04-01T00:00:00';
  const Q2_NOW = '2026-04-08T23:59:59.999';

  const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

  // Fetch all deals created in Q2 so far — SALES PIPELINE ONLY
  const { data: deals, error } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, hubspot_created_at, deal_stage, pipeline, hubspot_owner_id, close_date')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', Q2_START)
    .lte('hubspot_created_at', Q2_NOW)
    .order('hubspot_created_at', { ascending: true });

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  if (!deals || deals.length === 0) {
    console.log('No deals found created in Q2 2026 (Apr 1 - Apr 8).');
    process.exit(0);
  }

  // Fetch owners for name mapping
  const { data: owners } = await supabase
    .from('owners')
    .select('hubspot_owner_id, first_name, last_name, email');

  const ownerMap = new Map<string, string>();
  if (owners) {
    for (const o of owners) {
      ownerMap.set(o.hubspot_owner_id, `${o.first_name} ${o.last_name}`);
    }
  }

  // Lead source breakdown
  const leadSourceCounts = new Map<string, number>();
  for (const d of deals) {
    const src = d.lead_source || '(none)';
    leadSourceCounts.set(src, (leadSourceCounts.get(src) || 0) + 1);
  }

  // Build markdown
  const lines: string[] = [];
  lines.push('# Q2 2026 Deals Created (Apr 1 – Apr 8)');
  lines.push('');
  lines.push(`**Total deals created:** ${deals.length}`);
  lines.push('');

  // Lead source summary
  lines.push('## Lead Source Breakdown');
  lines.push('');
  lines.push('| Lead Source | Count | % |');
  lines.push('|------------|------:|--:|');
  const sorted = [...leadSourceCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [src, count] of sorted) {
    const pct = ((count / deals.length) * 100).toFixed(1);
    lines.push(`| ${src} | ${count} | ${pct}% |`);
  }
  lines.push('');

  // Deal list as CSV-style table
  lines.push('## All Deals');
  lines.push('');
  lines.push('| # | HubSpot ID | Deal Name | Amount | Lead Source | Created | Owner | Stage | Close Date |');
  lines.push('|--:|-----------|-----------|-------:|------------|---------|-------|-------|-----------|');
  deals.forEach((d, i) => {
    const owner = ownerMap.get(d.hubspot_owner_id) || d.hubspot_owner_id || '—';
    const amount = d.amount ? `$${Number(d.amount).toLocaleString()}` : '—';
    const created = d.hubspot_created_at ? new Date(d.hubspot_created_at).toISOString().slice(0, 10) : '—';
    const closeDate = d.close_date || '—';
    const leadSrc = d.lead_source || '(none)';
    const name = d.deal_name || '—';
    const stage = d.deal_stage || '—';
    const hsId = d.hubspot_deal_id || '—';
    lines.push(`| ${i + 1} | ${hsId} | ${name} | ${amount} | ${leadSrc} | ${created} | ${owner} | ${stage} | ${closeDate} |`);
  });

  const md = lines.join('\n') + '\n';

  // Write to file
  const outPath = 'q2-deals-created-apr1-8.md';
  fs.writeFileSync(outPath, md);
  console.log(md);
  console.log(`\nWritten to ${outPath}`);
}

main().catch(console.error);
