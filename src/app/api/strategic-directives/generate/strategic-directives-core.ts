/**
 * Strategic Directives Engine — Main Orchestrator
 *
 * Three-phase pipeline:
 *   Phase 1: Domain extraction (parallel DB queries + stats)
 *   Phase 2: Domain briefs (6 parallel Opus calls)
 *   Phase 3: Cross-domain synthesis (Opus + extended thinking)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractAllDomains } from './domain-extractors';
import { generateAllBriefs } from './domain-briefs';
import { runCrossDomainSynthesis } from './cross-domain-synthesis';
import type { StrategicDirectivesReport, StrategicDirectivesOptions } from './types';

export async function runStrategicDirectives(
  supabase: SupabaseClient,
  options?: StrategicDirectivesOptions
): Promise<StrategicDirectivesReport> {
  const verbose = options?.verbose || false;

  // --- Phase 1: Domain Extraction ---
  if (verbose) console.log('\n=== Phase 1: Domain Extraction ===\n');
  const phase1Start = Date.now();

  const extractedData = await extractAllDomains(supabase, {
    timeRange: options?.timeRange,
  });

  const phase1Ms = Date.now() - phase1Start;

  if (verbose) {
    console.log('Data sources:');
    for (const ds of extractedData.dataSources) {
      console.log(`  ${ds.domain}: ${ds.recordCount} records (${ds.dateRange})`);
    }
    console.log(`  Company rollups: ${extractedData.correlations.companyRollups.length}`);
    console.log(`  Owner rollups: ${extractedData.correlations.ownerRollups.length}`);
    console.log(`  Temporal trends: ${extractedData.correlations.temporalTrends.length} weeks`);
    console.log(`Phase 1 completed in ${phase1Ms}ms\n`);
  }

  // Check if we have enough data
  const totalRecords = extractedData.dataSources.reduce((sum, ds) => sum + ds.recordCount, 0);
  if (totalRecords === 0) {
    throw new Error('No data found across any domain. Run analysis pipelines first.');
  }

  // --- Phase 2: Domain Briefs ---
  if (verbose) console.log('=== Phase 2: Domain Briefs (6 parallel Opus calls) ===\n');
  const phase2Start = Date.now();

  const briefs = await generateAllBriefs(extractedData);

  const phase2Ms = Date.now() - phase2Start;

  if (verbose) {
    for (const [key, brief] of Object.entries(briefs)) {
      console.log(`--- ${key} ---`);
      console.log(brief.rawText.slice(0, 200) + '...\n');
    }
    console.log(`Phase 2 completed in ${phase2Ms}ms\n`);
  }

  // --- Phase 3: Cross-Domain Strategic Synthesis ---
  if (verbose) console.log('=== Phase 3: Cross-Domain Synthesis (Opus + Extended Thinking) ===\n');

  const report = await runCrossDomainSynthesis(
    briefs,
    extractedData.correlations,
    extractedData.dataSources,
    { phase1Ms, phase2Ms },
    {
      focus: options?.focus,
      thinkingBudget: options?.thinkingBudget,
    }
  );

  if (verbose) {
    console.log(`Phase 3 completed in ${report.phase3DurationMs}ms`);
    console.log(`Total pipeline: ${report.totalDurationMs}ms`);
    console.log(`Directives generated: ${report.directives.length}`);
    console.log(`Cross-domain insights: ${report.crossDomainInsights.length}\n`);
  }

  return report;
}
