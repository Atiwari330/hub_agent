import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
  return deepseek('deepseek/deepseek-v3.2');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgeBucket { label: string; count: number; ticketIds: string[] }
interface Breakdown { [key: string]: number }
interface CompanyHotspot { name: string; id: string; count: number; oldestDays: number; slaBreaches: number }

interface HealthMetrics {
  totalOpen: number;
  ageBuckets: AgeBucket[];
  medianAgeDays: number;
  avgAgeDays: number;
  byCategory: Breakdown;
  bySoftware: Breakdown;
  byBallInCourt: Breakdown;
  bySourceType: Breakdown;
  byTicketType: Breakdown;
  byPriority: Breakdown;
  slaBreaches: { frt: number; nrt: number; both: number };
  engineeringEscalations: number;
  coDestinyOpen: number;
  closedLast30d: number;
  avgTimeToCloseHours: number | null;
  companyHotspots: CompanyHotspot[];
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeMetrics(openTickets: any[], closedTickets: any[]): HealthMetrics {
  const now = new Date();

  // Age calculation
  const ages = openTickets.map(t => {
    const created = new Date(t.hubspot_created_at || t.created_at);
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  });
  ages.sort((a, b) => a - b);

  const bucketDefs = [
    { label: '< 7 days', min: 0, max: 7 },
    { label: '7-14 days', min: 7, max: 14 },
    { label: '14-30 days', min: 14, max: 30 },
    { label: '30-60 days', min: 30, max: 60 },
    { label: '60+ days', min: 60, max: Infinity },
  ];

  const ageBuckets: AgeBucket[] = bucketDefs.map(b => ({
    label: b.label,
    count: 0,
    ticketIds: [],
  }));

  openTickets.forEach((t, i) => {
    const age = ages[i];
    const bucket = bucketDefs.findIndex(b => age >= b.min && age < b.max);
    if (bucket >= 0) {
      ageBuckets[bucket].count++;
      ageBuckets[bucket].ticketIds.push(t.hubspot_ticket_id);
    }
  });

  // Breakdowns
  const breakdown = (field: string): Breakdown => {
    const counts: Breakdown = {};
    for (const t of openTickets) {
      const val = t[field] || 'Unknown';
      counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  };

  // SLA
  let frt = 0, nrt = 0, both = 0;
  for (const t of openTickets) {
    const f = t.frt_sla_breached === true;
    const n = t.nrt_sla_breached === true;
    if (f) frt++;
    if (n) nrt++;
    if (f && n) both++;
  }

  // Engineering escalations
  const engineeringEscalations = openTickets.filter(t => !!t.linear_task).length;

  // Co-Destiny
  const coDestinyOpen = openTickets.filter(t => t.is_co_destiny === true).length;

  // Closed metrics
  const closeTimesMs = closedTickets
    .map(t => t.time_to_close)
    .filter((v): v is number => v !== null && v !== undefined && v > 0);
  const avgTimeToCloseHours = closeTimesMs.length > 0
    ? closeTimesMs.reduce((a, b) => a + b, 0) / closeTimesMs.length / (1000 * 60 * 60)
    : null;

  // Company hotspots
  const byCompany = new Map<string, { name: string; tickets: any[] }>();
  for (const t of openTickets) {
    const id = t.hs_primary_company_id || '__none__';
    const existing = byCompany.get(id);
    if (existing) {
      existing.tickets.push(t);
    } else {
      byCompany.set(id, { name: t.hs_primary_company_name || 'Unknown', tickets: [t] });
    }
  }
  const companyHotspots: CompanyHotspot[] = [];
  for (const [id, { name, tickets }] of byCompany) {
    if (tickets.length >= 3) {
      const oldestDays = Math.max(...tickets.map(t => {
        const created = new Date(t.hubspot_created_at || t.created_at);
        return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }));
      const slaBreaches = tickets.filter(t => t.frt_sla_breached || t.nrt_sla_breached).length;
      companyHotspots.push({ name, id, count: tickets.length, oldestDays, slaBreaches });
    }
  }
  companyHotspots.sort((a, b) => b.count - a.count);

  const median = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : 0;
  const avg = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;

  return {
    totalOpen: openTickets.length,
    ageBuckets,
    medianAgeDays: median,
    avgAgeDays: avg,
    byCategory: breakdown('category'),
    bySoftware: breakdown('software'),
    byBallInCourt: breakdown('ball_in_court'),
    bySourceType: breakdown('source_type'),
    byTicketType: breakdown('ticket_type'),
    byPriority: breakdown('priority'),
    slaBreaches: { frt, nrt, both },
    engineeringEscalations,
    coDestinyOpen,
    closedLast30d: closedTickets.length,
    avgTimeToCloseHours,
    companyHotspots,
  };
}

// ---------------------------------------------------------------------------
// Format metrics for display + LLM
// ---------------------------------------------------------------------------

function formatMetricsSection(m: HealthMetrics): string {
  let s = '';

  s += `## Open Tickets: ${m.totalOpen}\n\n`;

  s += `### Age Distribution\n`;
  s += `| Bucket | Count | % |\n|--------|-------|---|\n`;
  for (const b of m.ageBuckets) {
    const pct = m.totalOpen > 0 ? Math.round((b.count / m.totalOpen) * 100) : 0;
    s += `| ${b.label} | ${b.count} | ${pct}% |\n`;
  }
  s += `\n**Median age:** ${m.medianAgeDays} days | **Average age:** ${m.avgAgeDays} days\n\n`;

  const renderBreakdown = (title: string, bd: Breakdown) => {
    const sorted = Object.entries(bd).sort((a, b) => b[1] - a[1]);
    s += `### ${title}\n`;
    for (const [k, v] of sorted) {
      const pct = m.totalOpen > 0 ? Math.round((v / m.totalOpen) * 100) : 0;
      s += `- ${k}: ${v} (${pct}%)\n`;
    }
    s += '\n';
  };

  renderBreakdown('By Ball-in-Court', m.byBallInCourt);
  renderBreakdown('By Software', m.bySoftware);
  renderBreakdown('By Category', m.byCategory);
  renderBreakdown('By Source', m.bySourceType);
  renderBreakdown('By Type', m.byTicketType);
  renderBreakdown('By Priority', m.byPriority);

  s += `### SLA Health\n`;
  s += `- First Reply Time breaches: ${m.slaBreaches.frt}\n`;
  s += `- Next Reply Time breaches: ${m.slaBreaches.nrt}\n`;
  s += `- Both breached: ${m.slaBreaches.both}\n\n`;

  s += `### Escalations & VIP\n`;
  s += `- Engineering escalations (Linear linked): ${m.engineeringEscalations}\n`;
  s += `- Co-Destiny / VIP open tickets: ${m.coDestinyOpen}\n\n`;

  s += `### Resolution (last 30 days)\n`;
  s += `- Tickets closed: ${m.closedLast30d}\n`;
  s += `- Avg time to close: ${m.avgTimeToCloseHours !== null ? Math.round(m.avgTimeToCloseHours) + ' hours (' + Math.round(m.avgTimeToCloseHours / 24) + ' days)' : 'N/A'}\n\n`;

  if (m.companyHotspots.length > 0) {
    s += `### Company Hotspots (3+ open tickets)\n`;
    s += `| Company | Open | Oldest | SLA Breaches |\n|---------|------|--------|-------------|\n`;
    for (const h of m.companyHotspots) {
      s += `| ${h.name} | ${h.count} | ${h.oldestDays}d | ${h.slaBreaches} |\n`;
    }
    s += '\n';
  }

  return s;
}

// ---------------------------------------------------------------------------
// DeepSeek synthesis
// ---------------------------------------------------------------------------

async function synthesize(metricsText: string): Promise<string> {
  const model = getModel();

  const { text } = await generateText({
    model,
    system: `You are a blunt, experienced VP of Customer Support analyzing a support team's ticket metrics. You cut through noise and surface only what matters.

RULES:
- Be direct and specific. No filler, no hedging.
- Reference actual numbers from the data.
- If things look healthy, say so briefly and move on.
- If there are problems, name them concretely with the numbers that prove it.
- Keep the entire response under 300 words.

Output format:
VERDICT: <one sentence — is support healthy, strained, or in trouble?>

TOP CONCERNS:
<1-3 bullet points, or "None — metrics look healthy" if genuinely fine>

BRIGHT SPOTS:
<1-2 bullet points of what's going well, or skip if nothing stands out>

RECOMMENDATION:
<one concrete action the support leader should take this week>`,
    prompt: `Here are the current support ticket metrics:\n\n${metricsText}`,
  });

  return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let output: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--output=')) {
      output = args[i].split('=')[1];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx tsx src/scripts/support-health.ts [options]

Analyzes open support tickets and produces a health report with
age distribution, breakdowns, SLA health, and an AI synthesis.

Options:
  --output=FILE    Write report to file (default: support-health-YYYY-MM-DD.md)
  --help, -h       Show this help
`);
      process.exit(0);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  if (!output) output = `support-health-${today}.md`;

  console.log('Fetching tickets from Supabase...');
  const supabase = createServiceClient();

  const { data: openTickets, error: openErr } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('is_closed', false);

  if (openErr) throw new Error(`Failed to fetch open tickets: ${openErr.message}`);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: closedTickets, error: closedErr } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('is_closed', true)
    .gte('closed_date', thirtyDaysAgo.toISOString());

  if (closedErr) throw new Error(`Failed to fetch closed tickets: ${closedErr.message}`);

  console.log(`Found ${(openTickets || []).length} open tickets, ${(closedTickets || []).length} closed in last 30 days.`);

  const metrics = computeMetrics(openTickets || [], closedTickets || []);
  const metricsText = formatMetricsSection(metrics);

  console.log('Running DeepSeek synthesis...\n');
  const synthesis = await synthesize(metricsText);

  let report = `# Support Health Report — ${today}\n\n`;
  report += metricsText;
  report += `---\n\n## AI Synthesis (DeepSeek v3.2)\n\n${synthesis}\n`;
  report += `\n---\n\n*Generated at ${new Date().toISOString()}*\n`;

  console.log(report);

  fs.writeFileSync(output, report);
  console.log(`\nReport written to ${output}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
