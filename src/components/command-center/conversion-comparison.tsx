'use client';

import type { HistoricalRates } from '@/lib/q2-goal-tracker/types';

interface ConversionComparisonProps {
  q1: HistoricalRates;
  q2: HistoricalRates;
}

type Direction = 'up' | 'down' | 'flat' | 'na';

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function pctDelta(current: number, baseline: number): string {
  if (baseline === 0) return '';
  const delta = ((current - baseline) / baseline) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(0)}%`;
}

function dirFor(current: number, baseline: number, hasCurrent: boolean, higherIsBetter: boolean): Direction {
  if (!hasCurrent || baseline === 0) return 'na';
  if (current === baseline) return 'flat';
  const better = higherIsBetter ? current > baseline : current < baseline;
  return better ? 'up' : 'down';
}

function Arrow({ dir }: { dir: Direction }) {
  if (dir === 'na') return <span className="text-gray-400">—</span>;
  if (dir === 'flat') return <span className="text-gray-500">→</span>;
  const color = dir === 'up' ? 'text-emerald-600' : 'text-red-600';
  const glyph = dir === 'up' ? '▲' : '▼';
  return <span className={color}>{glyph}</span>;
}

interface CardProps {
  label: string;
  q2Value: string;        // formatted current-quarter value, or "—"
  q1Value: string;        // formatted Q1 value
  direction: Direction;   // arrow direction (better/worse/flat/na)
  deltaLabel: string;     // e.g. "+18%" or ""
  sampleHint: string;     // e.g. "n=3 of 21 created"
}

function ComparisonCard({ label, q2Value, q1Value, direction, deltaLabel, sampleHint }: CardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{q2Value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
        <span>vs Q1 {q1Value}</span>
        <Arrow dir={direction} />
        {deltaLabel && (
          <span className={
            direction === 'up' ? 'text-emerald-600 font-medium'
            : direction === 'down' ? 'text-red-600 font-medium'
            : 'text-gray-500'
          }>
            {deltaLabel}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-400">{sampleHint}</p>
    </div>
  );
}

export function ConversionComparison({ q1, q2 }: ConversionComparisonProps) {
  // Create → Demo: higher is better
  const hasCreateToDemo = q2.dealsCreatedCount > 0;
  const createToDemoDir = dirFor(q2.createToDemoRate, q1.createToDemoRate, hasCreateToDemo, true);

  // Demo → Won: higher is better
  // Q2 demo-to-won requires both a demo-completed sample *and* at least one closed-won
  // (the rate can be 0 legitimately when demos exist but none have closed yet).
  // We treat any quarter with demoCompletedCount > 0 as having a valid signal.
  const hasDemoToWon = q2.demoCompletedCount > 0;
  const demoToWonDir = dirFor(q2.demoToWonRate, q1.demoToWonRate, hasDemoToWon, true);

  // Leads Created: higher is better, count is always valid (0 is a real value, not missing)
  const leadsDir = dirFor(q2.dealsCreatedCount, q1.dealsCreatedCount, true, true);

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Conversion Health vs Q1</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ComparisonCard
          label="Create → Demo"
          q2Value={hasCreateToDemo ? formatPct(q2.createToDemoRate) : '—'}
          q1Value={formatPct(q1.createToDemoRate)}
          direction={createToDemoDir}
          deltaLabel={hasCreateToDemo ? pctDelta(q2.createToDemoRate, q1.createToDemoRate) : ''}
          sampleHint={
            hasCreateToDemo
              ? `n=${q2.demoCompletedCount} of ${q2.dealsCreatedCount} created`
              : 'No deals created yet'
          }
        />
        <ComparisonCard
          label="Demo → Closed Won"
          q2Value={hasDemoToWon ? formatPct(q2.demoToWonRate) : '—'}
          q1Value={formatPct(q1.demoToWonRate)}
          direction={demoToWonDir}
          deltaLabel={hasDemoToWon ? pctDelta(q2.demoToWonRate, q1.demoToWonRate) : ''}
          sampleHint={
            hasDemoToWon
              ? `n=${q2.closedWonCount} won of ${q2.demoCompletedCount} demoed`
              : 'No demos completed yet'
          }
        />
        <ComparisonCard
          label="Leads Created"
          q2Value={q2.dealsCreatedCount.toLocaleString()}
          q1Value={q1.dealsCreatedCount.toLocaleString()}
          direction={leadsDir}
          deltaLabel={pctDelta(q2.dealsCreatedCount, q1.dealsCreatedCount)}
          sampleHint="Q2 to-date vs Q1 full quarter"
        />
      </div>
    </div>
  );
}
