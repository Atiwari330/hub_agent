/**
 * Domain Enrichment CLI Script
 *
 * Usage:
 *   npx tsx src/scripts/enrich-domain.ts --email john@acmetherapy.com
 *   npx tsx src/scripts/enrich-domain.ts --domain acmetherapy.com
 *   npx tsx src/scripts/enrich-domain.ts --deal 12345678
 *   npx tsx src/scripts/enrich-domain.ts --email john@acmetherapy.com --verbose
 *   npx tsx src/scripts/enrich-domain.ts --email john@acmetherapy.com --dry-run
 *   npx tsx src/scripts/enrich-domain.ts --email john@acmetherapy.com --force
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { enrichFromEmail, enrichDomain, enrichDeal, type EnrichmentResult } from '../lib/enrichment/enrichment-pipeline';
import { extractDomain, isFreeEmailProvider } from '../lib/enrichment/domain-utils';

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verbose' || arg === '-v') {
      flags.verbose = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg === '--email' && args[i + 1]) {
      flags.email = args[++i];
    } else if (arg === '--domain' && args[i + 1]) {
      flags.domain = args[++i];
    } else if (arg === '--deal' && args[i + 1]) {
      flags.deal = args[++i];
    }
  }

  return flags;
}

function printUsage() {
  console.log(`
Domain Enrichment CLI

Usage:
  npx tsx src/scripts/enrich-domain.ts --email <email>    Enrich from an email address
  npx tsx src/scripts/enrich-domain.ts --domain <domain>  Enrich from a domain directly
  npx tsx src/scripts/enrich-domain.ts --deal <dealId>    Enrich all contacts from a HubSpot deal

Options:
  --verbose, -v   Show detailed output (raw markdown, prompts, full JSON)
  --dry-run       Show what would happen without calling APIs
  --force         Re-enrich even if domain already exists in DB

Examples:
  npx tsx src/scripts/enrich-domain.ts --email john@acmetherapy.com
  npx tsx src/scripts/enrich-domain.ts --domain opusbehavioral.com --verbose
  npx tsx src/scripts/enrich-domain.ts --deal 12345678 --verbose
  npx tsx src/scripts/enrich-domain.ts --email test@gmail.com
`);
}

function printResult(result: EnrichmentResult) {
  const divider = '─'.repeat(60);

  console.log(`\n${divider}`);
  console.log(`Domain:  ${result.domain}`);
  console.log(`Status:  ${result.status}`);

  if (result.skipReason) {
    console.log(`Reason:  ${result.skipReason}`);
    console.log(divider);
    return;
  }

  if (result.error) {
    console.log(`Error:   ${result.error}`);
  }

  if (result.scrapeResult) {
    console.log(`URL:     ${result.scrapeResult.url}`);
    console.log(`Scraped: ${result.scrapeResult.markdown.length} chars`);
  }

  if (result.analysis) {
    const a = result.analysis;
    console.log(`\n  Company:     ${a.company_name || '(unknown)'}`);
    console.log(`  Overview:    ${a.company_overview || '(none)'}`);
    console.log(`  Confidence:  ${(a.confidence_score * 100).toFixed(0)}%`);
    console.log(`  Parked:      ${a.is_parked_domain ? 'Yes' : 'No'}`);

    if (a.services.length > 0) {
      console.log(`\n  Services (${a.services.length}):`);
      for (const s of a.services) {
        console.log(`    - ${s.name}: ${s.description}`);
      }
    }

    if (a.specialties.length > 0) {
      console.log(`\n  Specialties: ${a.specialties.join(', ')}`);
    }

    if (a.team_members.length > 0) {
      console.log(`\n  Team Members (${a.team_members.length}):`);
      for (const m of a.team_members) {
        console.log(`    - ${m.name} (${m.title})${m.bio ? ` - ${m.bio}` : ''}`);
      }
    }

    if (a.community_events.length > 0) {
      console.log(`\n  Events (${a.community_events.length}):`);
      for (const e of a.community_events) {
        console.log(`    - ${e.name}${e.date ? ` (${e.date})` : ''}: ${e.description}`);
      }
    }

    if (a.locations.length > 0) {
      console.log(`\n  Locations: ${a.locations.join(', ')}`);
    }
  }

  console.log(divider);
}

async function main() {
  const flags = parseArgs();

  if (!flags.email && !flags.domain && !flags.deal) {
    printUsage();
    process.exit(1);
  }

  const options = {
    verbose: !!flags.verbose,
    dryRun: !!flags.dryRun,
    force: !!flags.force,
  };

  console.log('\nDomain Enrichment');
  console.log('═'.repeat(60));

  if (options.dryRun) console.log('MODE: Dry run (no API calls or storage)');
  if (options.force) console.log('MODE: Force (re-enrich existing domains)');

  const startTime = Date.now();

  try {
    if (flags.email) {
      const email = flags.email as string;
      console.log(`\nInput: ${email}`);

      const domain = extractDomain(email);
      if (domain) {
        console.log(`Domain: ${domain}`);
        console.log(`Free provider: ${isFreeEmailProvider(domain) ? 'Yes' : 'No'}`);
      }

      const result = await enrichFromEmail(email, options);
      printResult(result);

      if (options.verbose && result.scrapeResult?.markdown) {
        console.log('\n--- Raw Markdown (first 2000 chars) ---');
        console.log(result.scrapeResult.markdown.slice(0, 2000));
        console.log('--- End Markdown ---\n');
      }

      if (options.verbose && result.analysis) {
        console.log('\n--- Full Analysis JSON ---');
        console.log(JSON.stringify(result.analysis, null, 2));
        console.log('--- End JSON ---\n');
      }
    } else if (flags.domain) {
      const domain = flags.domain as string;
      console.log(`\nInput: ${domain}`);

      const result = await enrichDomain(domain, options);
      printResult(result);

      if (options.verbose && result.scrapeResult?.markdown) {
        console.log('\n--- Raw Markdown (first 2000 chars) ---');
        console.log(result.scrapeResult.markdown.slice(0, 2000));
        console.log('--- End Markdown ---\n');
      }

      if (options.verbose && result.analysis) {
        console.log('\n--- Full Analysis JSON ---');
        console.log(JSON.stringify(result.analysis, null, 2));
        console.log('--- End JSON ---\n');
      }
    } else if (flags.deal) {
      const dealId = flags.deal as string;
      console.log(`\nDeal ID: ${dealId}`);

      const { results } = await enrichDeal(dealId, options);

      console.log(`\nProcessed ${results.length} domain(s):`);
      for (const result of results) {
        printResult(result);
      }

      // Summary
      const summary = {
        total: results.length,
        success: results.filter((r) => r.status === 'success').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        already: results.filter((r) => r.status === 'already_enriched').length,
        failed: results.filter((r) => ['failed', 'unreachable', 'parked'].includes(r.status)).length,
      };

      console.log(`\nSummary: ${summary.success} enriched, ${summary.skipped} skipped, ${summary.already} already done, ${summary.failed} failed`);
    }
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${duration}s`);
}

main();
