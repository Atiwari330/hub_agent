import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { runTicketTriage } from '../lib/briefing/run-ticket-triage';
import { runDealScrub } from '../lib/briefing/run-deal-scrub';
import { runPplCadence } from '../lib/briefing/run-ppl-cadence';

const DEAL_SCRUB_AES = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
];

const PPL_CADENCE_AES = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
];

// ---------------------------------------------------------------------------
// Sync with retry
// ---------------------------------------------------------------------------

async function syncHubSpot(): Promise<{
  status: 'synced' | 'sync_failed_used_cache';
  completedAt: string | null;
}> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET || '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[sync] Attempt ${attempt}: syncing HubSpot data...`);
      const res = await fetch(`${baseUrl}/api/cron/sync-hubspot`, {
        headers: { authorization: `Bearer ${cronSecret}` },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sync returned ${res.status}: ${body}`);
      }

      const data = await res.json();
      console.log(`[sync] Success — ${data.ownersSynced ?? '?'} owners, ${data.dealsSynced ?? '?'} deals synced`);
      return { status: 'synced', completedAt: new Date().toISOString() };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[sync] Attempt ${attempt} failed: ${errMsg}`);
      if (attempt === 1) {
        console.log('[sync] Retrying in 30 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
    }
  }

  console.warn('[sync] Both attempts failed. Proceeding with cached data.');
  return { status: 'sync_failed_used_cache', completedAt: null };
}

// ---------------------------------------------------------------------------
// Section runner
// ---------------------------------------------------------------------------

type SectionType = 'ticket_triage' | 'deal_scrub' | 'ppl_cadence';

interface SectionConfig {
  sectionType: SectionType;
  ownerEmail: string | null;
  run: () => Promise<{
    results: unknown[];
    markdown: string;
    summary: Record<string, unknown>;
    durationMs: number;
  }>;
}

async function runSection(
  supabase: ReturnType<typeof createServiceClient>,
  sectionId: string,
  config: SectionConfig
): Promise<void> {
  // Mark as running
  await supabase
    .from('morning_briefing_sections')
    .update({ status: 'running' })
    .eq('id', sectionId);

  try {
    const result = await config.run();

    await supabase
      .from('morning_briefing_sections')
      .update({
        status: 'completed',
        results_json: result.results,
        results_markdown: result.markdown,
        summary_json: result.summary,
        item_count: result.results.length,
        duration_ms: result.durationMs,
      })
      .eq('id', sectionId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[${config.sectionType}] Section failed: ${errMsg}`);

    await supabase
      .from('morning_briefing_sections')
      .update({
        status: 'failed',
        error: errMsg,
      })
      .eq('id', sectionId);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];
  const githubRunId = process.env.GITHUB_RUN_ID || null;

  console.log(`\n========================================`);
  console.log(`  Morning Briefing — ${today}`);
  console.log(`========================================\n`);

  // Step 1: Sync HubSpot
  const syncResult = await syncHubSpot();

  // Step 2: Create run record
  const { data: run, error: runError } = await supabase
    .from('morning_briefing_runs')
    .upsert(
      {
        run_date: today,
        status: 'running',
        started_at: new Date().toISOString(),
        github_run_id: githubRunId,
        sync_status: syncResult.status,
        sync_completed_at: syncResult.completedAt,
      },
      { onConflict: 'run_date' }
    )
    .select('id')
    .single();

  if (runError || !run) {
    throw new Error(`Failed to create briefing run: ${runError?.message}`);
  }

  const runId = run.id;
  console.log(`[run] Created briefing run ${runId} for ${today}`);

  // Step 3: Define sections
  const sectionConfigs: SectionConfig[] = [
    {
      sectionType: 'ticket_triage',
      ownerEmail: null,
      run: async () => {
        const result = await runTicketTriage({ concurrency: 5 });
        return {
          results: result.results,
          markdown: result.markdown,
          summary: result.summary as unknown as Record<string, unknown>,
          durationMs: result.durationMs,
        };
      },
    },
    ...DEAL_SCRUB_AES.map((email) => ({
      sectionType: 'deal_scrub' as SectionType,
      ownerEmail: email,
      run: async () => {
        const result = await runDealScrub(email, { concurrency: 2 });
        return {
          results: result.results,
          markdown: result.markdown,
          summary: result.summary as unknown as Record<string, unknown>,
          durationMs: result.durationMs,
        };
      },
    })),
    {
      sectionType: 'ppl_cadence',
      ownerEmail: null,
      run: async () => {
        const result = await runPplCadence({
          ownerEmails: PPL_CADENCE_AES,
          concurrency: 3,
        });
        return {
          results: result.results,
          markdown: result.markdown,
          summary: result.summary as unknown as Record<string, unknown>,
          durationMs: result.durationMs,
        };
      },
    },
  ];

  // Step 4: Create section records
  const sectionIds: string[] = [];
  for (const cfg of sectionConfigs) {
    const { data: section, error: sectionError } = await supabase
      .from('morning_briefing_sections')
      .insert({
        run_id: runId,
        section_type: cfg.sectionType,
        owner_email: cfg.ownerEmail,
        status: 'pending',
      })
      .select('id')
      .single();

    if (sectionError || !section) {
      throw new Error(`Failed to create section: ${sectionError?.message}`);
    }
    sectionIds.push(section.id);
  }

  // Step 5: Run sections sequentially to avoid HubSpot 429 rate limiting
  // Each section fetches engagements for many deals — running in parallel
  // overwhelms HubSpot's 100 req/10s limit
  for (let i = 0; i < sectionConfigs.length; i++) {
    const label = sectionConfigs[i].ownerEmail
      ? `${sectionConfigs[i].sectionType} (${sectionConfigs[i].ownerEmail})`
      : sectionConfigs[i].sectionType;
    console.log(`\n--- Section ${i + 1}/${sectionConfigs.length}: ${label} ---\n`);
    await runSection(supabase, sectionIds[i], sectionConfigs[i]);
  }

  // Step 6: Determine final status
  const { data: sections } = await supabase
    .from('morning_briefing_sections')
    .select('status')
    .eq('run_id', runId);

  const statuses = sections?.map((s) => s.status) || [];
  const allCompleted = statuses.every((s) => s === 'completed');
  const allFailed = statuses.every((s) => s === 'failed');
  const finalStatus = allFailed ? 'failed' : allCompleted ? 'completed' : 'partial';

  await supabase
    .from('morning_briefing_runs')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  const completedCount = statuses.filter((s) => s === 'completed').length;
  const failedCount = statuses.filter((s) => s === 'failed').length;

  console.log(`\n========================================`);
  console.log(`  Briefing ${finalStatus.toUpperCase()}`);
  console.log(`  ${completedCount}/${statuses.length} sections completed, ${failedCount} failed`);
  console.log(`  Sync: ${syncResult.status}`);
  console.log(`========================================\n`);

  if (finalStatus === 'failed') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
