/**
 * Deals Analysis CLI
 *
 * Runs a comprehensive deals analysis and outputs a markdown report.
 *
 * Usage:
 *   npm run deals-analysis                    # Current year
 *   npm run deals-analysis -- --year=2025     # Specific year
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { runDealsAnalysis } from '../lib/analysis/deals-analysis';
import type { DealsAnalysisResult } from '../lib/analysis/types';

function cur(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function pct(n: number | null): string {
  if (n === null) return 'n/a';
  return (n * 100).toFixed(1) + '%';
}

function formatReport(r: DealsAnalysisResult): string {
  const lines: string[] = [];
  const h = (s: string) => lines.push(`\n${'='.repeat(80)}\n${s}\n${'='.repeat(80)}`);

  lines.push(`# Deals Analysis — ${r.year}`);
  lines.push(`Analysis date: ${r.analysisDate}`);

  // Revenue
  h('REVENUE (Closed Won in ' + r.year + ', Deduplicated)');
  lines.push(`Total deals: ${r.revenue.totalDeals}`);
  lines.push(`Total revenue: ${cur(r.revenue.totalRevenue)}`);
  lines.push(`Avg deal size: ${cur(r.revenue.avgDealSize)}`);
  lines.push(`Median deal size: ${cur(r.revenue.medianDealSize)}`);

  if (r.dataQuality.duplicatesFound.length > 0) {
    lines.push(`\nDuplicates removed: ${r.dataQuality.duplicatesFound.length} deals had multiple records`);
    lines.push(`Revenue inflation removed: ${cur(r.dataQuality.duplicateRevenueInflation)}`);
    for (const d of r.dataQuality.duplicatesFound) {
      lines.push(`  "${d.dealName}": ${d.recordCount} records at ${cur(d.amount)} each`);
    }
  }

  lines.push('\nBy Month:');
  for (const m of r.revenue.byMonth) {
    lines.push(`  ${m.month}: ${m.deals} deals, ${cur(m.revenue)}`);
  }

  lines.push('\nBy AE:');
  for (const a of r.revenue.byAE) {
    lines.push(`  ${a.name}${a.email ? ` (${a.email})` : ''}: ${a.deals} deals, ${cur(a.revenue)}`);
  }

  lines.push('\nBy Lead Source:');
  for (const s of r.revenue.bySource) {
    lines.push(`  ${s.source}: ${s.deals} deals, ${cur(s.revenue)} (${pct(s.pctOfRevenue)})`);
  }

  // Conversion
  h('CONVERSION (Created in ' + r.year + ')');
  lines.push(`Total created: ${r.conversion.totalCreated}`);
  lines.push(`Closed Won: ${r.conversion.closedWon} (${pct(r.conversion.closedWon / r.conversion.totalCreated)})`);
  lines.push(`Closed Lost: ${r.conversion.closedLost} (${pct(r.conversion.closedLost / r.conversion.totalCreated)})`);
  lines.push(`Still Open: ${r.conversion.stillOpen} (${pct(r.conversion.stillOpen / r.conversion.totalCreated)})`);
  lines.push(`Win Rate (of closed): ${pct(r.conversion.winRateOfClosed)}`);
  lines.push(`Won Revenue: ${cur(r.conversion.wonRevenue)}`);
  lines.push(`Open Pipeline: ${cur(r.conversion.openPipeline)}`);
  if (r.conversion.avgDaysToClose !== null) {
    lines.push(`Avg days to close: ${r.conversion.avgDaysToClose.toFixed(1)}`);
    lines.push(`Median days to close: ${r.conversion.medianDaysToClose?.toFixed(1)}`);
  }

  // Lead Sources
  h('LEAD SOURCE PERFORMANCE (Created in ' + r.year + ')');
  const hdr = 'Source'.padEnd(30) + 'Total'.padStart(6) + 'Won'.padStart(6) + 'Lost'.padStart(6) +
    'Open'.padStart(6) + 'WinRate'.padStart(9) + 'Revenue'.padStart(12) + 'Demo%'.padStart(8);
  lines.push(hdr);
  lines.push('-'.repeat(hdr.length));
  for (const s of r.leadSources) {
    lines.push(
      s.source.substring(0, 29).padEnd(30) +
      String(s.total).padStart(6) +
      String(s.won).padStart(6) +
      String(s.lost).padStart(6) +
      String(s.open).padStart(6) +
      pct(s.winRate).padStart(9) +
      cur(s.wonRevenue).padStart(12) +
      pct(s.demoRate).padStart(8)
    );
  }

  lines.push('\nLead Source → Detail:');
  for (const d of r.leadSourceDetails.slice(0, 20)) {
    const cl = d.won + d.lost;
    lines.push(`  ${d.source} → ${d.detail}: ${d.total} deals, ${d.won} won${cl > 0 ? ` (${pct(d.winRate)})` : ''}, rev ${cur(d.wonRevenue)}`);
  }

  // AE Performance
  h('AE PERFORMANCE (Created in ' + r.year + ')');
  for (const a of r.aePerformance) {
    lines.push(`\n${a.name}${a.email ? ` (${a.email})` : ''}:`);
    lines.push(`  Total: ${a.total} | Won: ${a.won} | Lost: ${a.lost} | Open: ${a.open} | Win Rate: ${pct(a.winRate)}`);
    lines.push(`  Won Revenue: ${cur(a.wonRevenue)}`);
    if (a.avgDaysToClose !== null) lines.push(`  Avg Days to Close: ${a.avgDaysToClose.toFixed(1)}`);
    for (const s of a.sourceBreakdown) {
      const cl = s.won + s.lost;
      lines.push(`    ${s.source}: ${s.total} deals, ${s.won} won, ${s.lost} lost${cl > 0 ? ` (${pct(s.winRate)})` : ''}`);
    }
  }

  // Funnel
  h('FUNNEL PROGRESSION (Created in ' + r.year + ')');
  for (const s of r.funnel.stages) {
    lines.push(`  ${s.stage}: ${s.reached} (${pct(s.pctOfTotal)})`);
  }
  lines.push('\nStage transitions:');
  for (const t of r.funnel.transitions) {
    const timing = t.avgDays !== null ? `, avg ${t.avgDays.toFixed(1)}d, median ${t.medianDays?.toFixed(1)}d, n=${t.sampleSize}` : '';
    lines.push(`  ${t.from} → ${t.to}: ${pct(t.rate)}${timing}`);
  }

  // Data Quality
  h('DATA QUALITY');
  lines.push(`Missing/zero amount: ${r.dataQuality.missingAmount} (${pct(r.dataQuality.missingAmountPct)})`);
  lines.push(`Missing lead source: ${r.dataQuality.missingLeadSource} (${pct(r.dataQuality.missingLeadSourcePct)})`);
  lines.push(`Missing close date: ${r.dataQuality.missingCloseDate} (${pct(r.dataQuality.missingCloseDatePct)})`);
  lines.push(`Missing owner: ${r.dataQuality.missingOwner} (${pct(r.dataQuality.missingOwnerPct)})`);

  return lines.join('\n');
}

async function main() {
  const yearArg = process.argv.find(a => a.startsWith('--year='));
  const year = yearArg ? parseInt(yearArg.split('=')[1]) : undefined;

  console.log(`Running deals analysis${year ? ` for ${year}` : ''}...`);
  const result = await runDealsAnalysis({ year });
  console.log(formatReport(result));
}

main().catch(console.error);
