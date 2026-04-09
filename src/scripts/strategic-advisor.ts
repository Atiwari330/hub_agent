import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { generateText } from 'ai';
import { getOpusModel } from '../lib/ai/provider';
import { gatherAllData, serializeDataForLLM } from '../lib/strategic-advisor/gather-data';
import {
  PASS_1_SITUATION_ASSESSMENT,
  PASS_2_OPPORTUNITIES_AND_THREATS,
  PASS_3_ACTION_PLAN,
  PASS_4_EXECUTIVE_BRIEFING,
  getFocusModifier,
  distillPass1,
  distillPass2,
} from '../lib/strategic-advisor/prompts';
import { formatStrategicReport } from '../lib/strategic-advisor/format-report';
import fs from 'fs';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  focus: string | null;
  brief: boolean;
  verbose: boolean;
  output: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { focus: null, brief: false, verbose: false, output: null };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(`
Strategic Advisor CLI — Adi's personal Q2 strategy engine

Usage:
  npm run advise                      Full 4-pass analysis (Claude Opus 4.6)
  npm run advise -- --brief           2-pass mode (situation + briefing only)
  npm run advise -- --focus=pipeline  Focus on pipeline health
  npm run advise -- --focus=forecast  Focus on forecast accuracy
  npm run advise -- --focus=team      Focus on AE performance & coaching
  npm run advise -- --verbose         Include raw data appendix
  npm run advise -- --output=FILE     Custom output file path
`);
      process.exit(0);
    }
    if (arg.startsWith('--focus=')) result.focus = arg.split('=')[1];
    if (arg === '--brief') result.brief = true;
    if (arg === '--verbose') result.verbose = true;
    if (arg.startsWith('--output=')) result.output = arg.split('=')[1];
  }

  if (result.focus && !['pipeline', 'forecast', 'team'].includes(result.focus)) {
    console.error(`Invalid focus: ${result.focus}. Must be one of: pipeline, forecast, team`);
    process.exit(1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const today = new Date().toISOString().split('T')[0];
  const model = getOpusModel();

  console.log('\n╔══════════════════════════════════╗');
  console.log('║      STRATEGIC ADVISOR           ║');
  console.log('╚══════════════════════════════════╝');
  console.log(`  Date: ${today}`);
  console.log(`  Focus: ${args.focus || 'full analysis'}`);
  console.log(`  Mode: ${args.brief ? 'brief (2 passes)' : 'deep (4 passes)'}`);
  console.log(`  Model: Claude Opus 4.6\n`);

  // ── Step 1: Gather all data ──
  console.log('⏳ Gathering data from Supabase...');
  const supabase = createServiceClient();
  const data = await gatherAllData(supabase);
  const serializedData = serializeDataForLLM(data);
  console.log(`  ✓ Data gathered. Week ${data.goalTracker.progress.currentWeek}/13, ${data.q2Deals.length} Q2 deals\n`);

  const focusModifier = getFocusModifier(args.focus);

  // ── Step 2: Pass 1 — Situation Assessment ──
  console.log('⏳ Pass 1: Situation Assessment...');
  const pass1 = await generateText({
    model,
    system: PASS_1_SITUATION_ASSESSMENT + focusModifier,
    prompt: serializedData,
  });
  console.log('  ✓ Done\n');

  const pass1Summary = distillPass1(pass1.text);

  if (args.brief) {
    // Brief mode: skip passes 2-3, go straight to executive briefing
    console.log('⏳ Pass 2 (brief): Executive Briefing...');
    const pass4 = await generateText({
      model,
      system: PASS_4_EXECUTIVE_BRIEFING + focusModifier,
      prompt: `${pass1Summary}\nFULL DATA:\n${serializedData}`,
    });
    console.log('  ✓ Done\n');

    const report = formatStrategicReport(
      pass1.text,
      null,
      null,
      pass4.text,
      data,
      { verbose: args.verbose, focus: args.focus, brief: true },
    );

    const outputFile = args.output || `strategic-advisor-${today}.md`;
    fs.writeFileSync(outputFile, report, 'utf-8');
    console.log(`\n📄 Report written to ${outputFile}\n`);
    console.log(report);
    return;
  }

  // ── Step 3: Pass 2 — Opportunities & Threats ──
  console.log('⏳ Pass 2: Opportunities & Threats...');
  const pass2 = await generateText({
    model,
    system: PASS_2_OPPORTUNITIES_AND_THREATS + focusModifier,
    prompt: `${pass1Summary}\nFULL DATA:\n${serializedData}`,
  });
  console.log('  ✓ Done\n');

  const pass2Summary = distillPass2(pass2.text);

  // ── Step 4: Pass 3 — Action Plan ──
  console.log('⏳ Pass 3: Action Plan...');
  const pass3 = await generateText({
    model,
    system: PASS_3_ACTION_PLAN + focusModifier,
    prompt: `${pass1Summary}\n${pass2Summary}\nFULL DATA:\n${serializedData}`,
  });
  console.log('  ✓ Done\n');

  // ── Step 5: Pass 4 — Executive Briefing ──
  console.log('⏳ Pass 4: Executive Briefing...');
  const pass4 = await generateText({
    model,
    system: PASS_4_EXECUTIVE_BRIEFING + focusModifier,
    prompt: `${pass1Summary}\nACTION PLAN:\n${pass3.text}\n\nFULL DATA:\n${serializedData}`,
  });
  console.log('  ✓ Done\n');

  // ── Step 6: Format and output ──
  const report = formatStrategicReport(
    pass1.text,
    pass2.text,
    pass3.text,
    pass4.text,
    data,
    { verbose: args.verbose, focus: args.focus, brief: false },
  );

  const outputFile = args.output || `strategic-advisor-${today}.md`;
  fs.writeFileSync(outputFile, report, 'utf-8');
  console.log(`\n📄 Report written to ${outputFile}\n`);
  console.log(report);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('strategic-advisor');
if (isDirectRun) {
  main().catch((err) => {
    console.error('\nFatal error:', err);
    process.exit(1);
  });
}
