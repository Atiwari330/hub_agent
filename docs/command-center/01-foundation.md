# Foundation: DB Schema, Types, Config, Data Layer

## Git & Execution Rules

1. **Create and work on branch `feature/q2-command-center`** — run `git checkout -b feature/q2-command-center` before starting
2. **DO NOT merge to `main`** — the user will approve the merge when all phases are complete
3. **Run all verification steps** at the end of this doc before declaring done
4. **Commit all work** with a message like: `feat: Q2 Command Center — Foundation (DB, types, config, pacing compute)`
5. **STOP after this phase** — do not continue to Phase 1. Report what was built and verification results to the user.

## Context

This is the first phase of the Q2 Command Center build. Nothing exists yet. This phase creates the database tables, TypeScript types, configuration, and core computation functions that all subsequent phases depend on.

**IMPORTANT: This is additive.** The existing Q2 Goal Tracker (`/dashboard/q2-goal-tracker`, `src/lib/q2-goal-tracker/`, `src/components/dashboard/q2-goal-tracker-view.tsx`, `src/app/api/q2-goal-tracker/`) must not be modified. The Command Center imports from the existing tracker's data layer but lives in its own directory (`src/lib/command-center/`, `src/components/command-center/`).

**Read `00-master-plan.md` first** for the full architecture and code inventory.

## What This Phase Creates

1. A Supabase migration with 2 new tables
2. Shared TypeScript types for the entire Command Center
3. Configuration (team target, AE targets, initiative-to-lead-source mapping, likelihood tiers)
4. `computeLeadPacing()` — leads created by source by week vs required
5. `computeDealPacing()` — deals created by week vs required
6. `computeInitiativeStatus()` — per-initiative progress vs target
7. Auth resource registration for the new page
8. Deal intelligence cron fix: workflow_runs logging, hardcoded DeepSeek v3.2 model, scheduled at 2:30 AM (after sync-hubspot at 2:00 AM)
9. `getDeepSeekModel()` export in `src/lib/ai/provider.ts`
10. `vercel.json` updated with deal intelligence cron schedule
11. A verification script

## What This Phase Does NOT Create

- No API routes (Phase 1)
- No UI components (Phase 1)
- No page routes (Phase 1)

---

## Step 1: Database Migration

**Create:** `supabase/migrations/072_command_center.sql`

The latest existing migration is `071_pricing_compliance_permissions.sql`.

```sql
-- Strategic initiatives with lead_source mapping and quarterly targets
CREATE TABLE IF NOT EXISTS strategic_initiatives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  lead_source_values TEXT[] NOT NULL,        -- HubSpot lead_source values that map to this initiative
  q2_lead_target INTEGER,                     -- Expected lead (deal creation) count for Q2
  q2_deal_target INTEGER,                     -- Expected deal progression target
  q2_arr_target DECIMAL(15,2),               -- Expected ARR contribution
  weekly_lead_pace INTEGER,                   -- Expected leads per week
  weekly_deal_pace INTEGER,                   -- Expected deals per week
  owner_label TEXT,                            -- Who owns this initiative (e.g., "CEO", "Marketing")
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial initiatives
-- NOTE: Update lead_source_values to match exact HubSpot lead_source strings
INSERT INTO strategic_initiatives (name, lead_source_values, q2_lead_target, q2_arr_target, weekly_lead_pace, owner_label, description)
VALUES
  ('CEO Channel Partners', ARRAY['Channel Partner'], 30, 150000, 3, 'CEO', 'CEO-led channel partner referral program'),
  ('Co-Destiny Referrals', ARRAY['Co-Destiny'], 20, 100000, 2, 'Partnerships', 'Co-destiny referral initiative');

-- Human overrides of AI deal judgments with audit trail
CREATE TABLE IF NOT EXISTS deal_forecast_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hubspot_deal_id TEXT NOT NULL UNIQUE,
  original_likelihood TEXT,                   -- What the AI said (e.g., "likely", "at_risk")
  override_likelihood TEXT NOT NULL,          -- What the human says
  override_amount DECIMAL(15,2),             -- Optional: override deal amount for forecast
  override_close_date DATE,                   -- Optional: override expected close date
  override_reason TEXT NOT NULL,              -- Required: why the override was made
  overridden_by TEXT NOT NULL,                -- Email of person who overrode
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_forecast_overrides_deal ON deal_forecast_overrides(hubspot_deal_id);

-- Add command center permission for existing vp_revops users
-- (vp_revops role already has access to everything via hasPermission() logic,
-- but we register the resource for consistency)
```

**Apply:** Run via Supabase dashboard SQL editor, or `npx supabase db push` if using local Supabase.

---

## Step 2: Shared Types

**Create:** `src/lib/command-center/types.ts`

These types define the data shapes for all Command Center API responses. Import existing types from `src/lib/q2-goal-tracker/types.ts` where they overlap — don't duplicate.

```typescript
/**
 * Shared types for Q2 Command Center.
 * Imports from q2-goal-tracker/types.ts where shapes overlap.
 */

import type {
  HistoricalRates,
  RateSet,
  LeadSourceRate,
  AEData,
  WeeklyActual,
  PipelineCredit,
  Q2GoalTrackerApiResponse,
} from '@/lib/q2-goal-tracker/types';

// Re-export for convenience
export type {
  HistoricalRates,
  RateSet,
  LeadSourceRate,
  AEData,
  WeeklyActual,
  PipelineCredit,
  Q2GoalTrackerApiResponse,
};

// ── Pacing ──

export interface WeeklyPacingRow {
  weekNumber: number;        // 1-13
  weekStart: string;         // YYYY-MM-DD
  weekEnd: string;
  leadsCreated: number;      // deals created this week
  dealsToDemo: number;       // deals that entered demo this week
  closedWonARR: number;
  closedWonCount: number;
}

export interface SourcePacing {
  source: string;
  totalCreated: number;      // deals created from this source in Q2
  weeklyBreakdown: number[]; // 13 weeks of deal creation counts
  requiredTotal: number;     // what's needed from this source to hit goal
  paceStatus: 'ahead' | 'on_pace' | 'behind';
}

export interface PacingData {
  weeklyRows: WeeklyPacingRow[];
  sourceBreakdown: SourcePacing[];
  totalLeadsCreated: number;
  totalLeadsRequired: number;
  totalDealsCreated: number;
  totalDealsRequired: number;
}

// ── Initiatives ──

export interface InitiativeStatus {
  id: string;
  name: string;
  ownerLabel: string;
  leadSourceValues: string[];
  // Targets
  q2LeadTarget: number;
  q2ArrTarget: number;
  weeklyLeadPace: number;
  // Actuals
  leadsCreated: number;       // deals from this initiative's lead sources
  arrGenerated: number;       // total amount from those deals
  closedWonARR: number;       // closed-won amount
  // Pacing
  expectedByNow: number;      // based on weekly pace × weeks elapsed
  paceStatus: 'ahead' | 'on_pace' | 'behind';
  weeklyBreakdown: number[];  // 13 weeks of creation counts
}

// ── Deal Forecast (Phase 2-3) ──

export type LikelihoodTier = 'highly_likely' | 'likely' | 'possible' | 'unlikely' | 'insufficient_data';

export interface DealForecastItem {
  hubspotDealId: string;
  dealName: string;
  ownerName: string;
  ownerId: string | null;
  amount: number;
  stage: string;
  stageId: string;
  closeDate: string | null;
  leadSource: string | null;
  // Intelligence scores
  overallGrade: string;
  overallScore: number;
  hygieneScore: number;
  momentumScore: number;
  engagementScore: number;
  riskScore: number;
  // LLM assessment
  llmStatus: string | null;
  buyerSentiment: string | null;
  dealMomentum: string | null;
  keyRisk: string | null;
  recommendedAction: string | null;
  reasoning: string | null;
  // Derived
  likelihoodTier: LikelihoodTier;
  // Override (if any)
  override: {
    likelihood: string;
    amount: number | null;
    reason: string;
    overriddenBy: string;
    overriddenAt: string;
  } | null;
}

// ── AE Execution (Phase 2) ──

export interface AEExecutionSummary {
  name: string;
  email: string;
  ownerId: string | null;
  q2Target: number;
  closedWonARR: number;
  pipelineARR: number;
  dealCount: number;
  avgGrade: string;
  gradeDistribution: { A: number; B: number; C: number; D: number; F: number };
  dealsNeedingAttention: number; // D + F grades
  avgScore: number;
}

// ── Forecast (Phase 3) ──

export interface ForecastSummary {
  totalWeighted: number;           // Sum of (amount × likelihood weight) across all deals
  target: number;
  gap: number;                      // max(0, target - totalWeighted)
  tiers: {
    highly_likely: { count: number; rawARR: number; weightedARR: number };
    likely: { count: number; rawARR: number; weightedARR: number };
    possible: { count: number; rawARR: number; weightedARR: number };
    unlikely: { count: number; rawARR: number; weightedARR: number };
    insufficient_data: { count: number; rawARR: number; weightedARR: number };
  };
  closedWonARR: number;            // Already closed this quarter
  projectedTotal: number;          // closedWon + totalWeighted
  confidenceLevel: 'high' | 'medium' | 'low';
}

// ── Command Center API Response (Phase 1) ──

export interface CommandCenterResponse {
  // From existing Q2 goal tracker
  goalTracker: Q2GoalTrackerApiResponse;
  // New pacing data
  pacing: PacingData;
  // Initiative tracking
  initiatives: InitiativeStatus[];
}
```

---

## Step 3: Configuration

**Create:** `src/lib/command-center/config.ts`

```typescript
/**
 * Command Center configuration.
 *
 * AE targets and team total are imported from q2-goal-tracker/compute.ts
 * where they're already maintained. This file adds command-center-specific config.
 */

// Likelihood tier weights for forecast calculation
// These determine how much each deal contributes to the weighted forecast
export const LIKELIHOOD_WEIGHTS: Record<string, number> = {
  highly_likely: 0.85,
  likely: 0.65,
  possible: 0.40,
  unlikely: 0.15,
  insufficient_data: 0.30,
};

// Map deal intelligence scores + LLM assessment to a likelihood tier
// This is the bridge between the existing deal-rules.ts scoring and the forecast
export function computeLikelihoodTier(
  overallScore: number,
  llmStatus: string | null,
  buyerSentiment: string | null,
): string {
  // LLM status takes priority when available
  if (llmStatus === 'on_track' && overallScore >= 70) return 'highly_likely';
  if (llmStatus === 'on_track') return 'likely';
  if (llmStatus === 'needs_action' && overallScore >= 55) return 'possible';
  if (llmStatus === 'at_risk') return 'unlikely';
  if (llmStatus === 'stalled') return 'unlikely';
  if (llmStatus === 'nurture') return 'unlikely';

  // Fall back to score-only when no LLM assessment
  if (overallScore >= 80) return 'likely';
  if (overallScore >= 60) return 'possible';
  if (overallScore >= 40) return 'unlikely';
  return 'insufficient_data';
}

// Team Q2 target (kept in sync with q2-goal-tracker/compute.ts AE_TARGETS)
export const Q2_TEAM_TARGET = 925000;
```

---

## Step 4: Pacing Computation

**Create:** `src/lib/command-center/compute-pacing.ts`

This computes lead/deal creation pacing by week and by source for Q2.

**Reuses:**
- `computeQ2GoalTrackerData()` from `src/lib/q2-goal-tracker/compute.ts` — provides the existing goal tracker data (rates, AE data, weekly actuals, pipeline credit)
- `getQuarterInfo()`, `getQuarterProgress()` from `src/lib/utils/quarter.ts`
- `computeLeadsNeeded()`, `computeDemosNeeded()`, `computeDealsNeeded()` from `src/lib/q2-goal-tracker/math.ts`

```typescript
/**
 * Pacing computation for the Command Center.
 *
 * Computes how deal creation by source and by week is tracking
 * relative to what's required to hit the Q2 ARR goal.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import type { PacingData, WeeklyPacingRow, SourcePacing } from './types';
import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import { computeLeadsNeeded, computeDemosNeeded, computeDealsNeeded } from '@/lib/q2-goal-tracker/math';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

export async function computePacingData(
  supabase: SupabaseClient,
  goalTrackerData: Q2GoalTrackerApiResponse,
): Promise<PacingData> {
  const q2 = getQuarterInfo(2026, 2);
  const progress = getQuarterProgress(q2);
  const currentWeek = Math.min(13, Math.ceil(progress.daysElapsed / 7));
  const q2Start = q2.startDate;

  // Fetch all Q2 deals from Supabase (created in Q2 + in sales pipeline)
  const { data: q2Deals, error } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, hubspot_created_at, demo_completed_entered_at, closed_won_entered_at, deal_stage')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', q2.startDate.toISOString())
    .lte('hubspot_created_at', q2.endDate.toISOString());

  if (error) throw new Error(`Failed to fetch Q2 deals: ${error.message}`);
  const deals = q2Deals || [];

  // Use the default rate set (first = Q1 2026) for required calculations
  const rates = goalTrackerData.historicalRates;
  const teamTarget = goalTrackerData.teamTarget;

  // How many deals/demos/leads needed total for Q2
  const dealsNeeded = computeDealsNeeded(teamTarget, rates.avgDealSize);
  const demosNeeded = computeDemosNeeded(dealsNeeded, rates.demoToWonRate);
  const leadsNeeded = computeLeadsNeeded(demosNeeded, rates.createToDemoRate);

  // ── Weekly rows ──
  const weeklyRows: WeeklyPacingRow[] = [];
  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(q2Start.getTime() + i * 7 * 86400000);
    const weekEnd = new Date(Math.min(weekStart.getTime() + 7 * 86400000 - 1, q2.endDate.getTime()));

    const weekDeals = deals.filter((d) => {
      if (!d.hubspot_created_at) return false;
      const t = new Date(d.hubspot_created_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    const weekDemos = deals.filter((d) => {
      if (!d.demo_completed_entered_at) return false;
      const t = new Date(d.demo_completed_entered_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    weeklyRows.push({
      weekNumber: i + 1,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      leadsCreated: weekDeals.length,
      dealsToDemo: weekDemos.length,
      closedWonARR: goalTrackerData.weeklyActuals[i]?.closedWonARR || 0,
      closedWonCount: goalTrackerData.weeklyActuals[i]?.closedWonCount || 0,
    });
  }

  // ── Source breakdown ──
  const sourceMap = new Map<string, { total: number; weekly: number[] }>();
  for (const d of deals) {
    const src = d.lead_source || '(no lead source)';
    if (!sourceMap.has(src)) sourceMap.set(src, { total: 0, weekly: new Array(13).fill(0) });
    const entry = sourceMap.get(src)!;
    entry.total++;

    if (d.hubspot_created_at) {
      const weekIdx = Math.floor((new Date(d.hubspot_created_at).getTime() - q2Start.getTime()) / (7 * 86400000));
      if (weekIdx >= 0 && weekIdx < 13) entry.weekly[weekIdx]++;
    }
  }

  // Calculate required per source using historical source rates
  const totalCreated = deals.length;
  const sourceBreakdown: SourcePacing[] = [...sourceMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, data]) => {
      // Proportional requirement based on historical source mix
      const historicalSource = goalTrackerData.leadSourceRates.find((s) => s.source === source);
      const requiredTotal = historicalSource
        ? Math.ceil(leadsNeeded * (historicalSource.dealsCreated / goalTrackerData.leadSourceRates.reduce((s, r) => s + r.dealsCreated, 0)))
        : 0;

      const expectedByNow = Math.ceil(requiredTotal * (currentWeek / 13));
      let paceStatus: 'ahead' | 'on_pace' | 'behind' = 'on_pace';
      if (data.total > expectedByNow * 1.1) paceStatus = 'ahead';
      else if (data.total < expectedByNow * 0.9) paceStatus = 'behind';

      return {
        source,
        totalCreated: data.total,
        weeklyBreakdown: data.weekly,
        requiredTotal,
        paceStatus,
      };
    });

  return {
    weeklyRows,
    sourceBreakdown,
    totalLeadsCreated: totalCreated,
    totalLeadsRequired: leadsNeeded,
    totalDealsCreated: totalCreated,
    totalDealsRequired: dealsNeeded,
  };
}
```

---

## Step 5: Initiative Computation

**Create:** `src/lib/command-center/compute-initiatives.ts`

```typescript
/**
 * Initiative tracking computation.
 *
 * Queries strategic_initiatives from Supabase, then counts deals
 * matching each initiative's lead_source values in Q2.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import type { InitiativeStatus } from './types';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const CLOSED_WON_STAGE_ID = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';

export async function computeInitiativeStatus(supabase: SupabaseClient): Promise<InitiativeStatus[]> {
  const q2 = getQuarterInfo(2026, 2);
  const progress = getQuarterProgress(q2);
  const currentWeek = Math.min(13, Math.ceil(progress.daysElapsed / 7));
  const q2Start = q2.startDate;

  // Fetch initiatives
  const { data: initiatives, error: initError } = await supabase
    .from('strategic_initiatives')
    .select('*')
    .eq('is_active', true);

  if (initError) throw new Error(`Failed to fetch initiatives: ${initError.message}`);
  if (!initiatives || initiatives.length === 0) return [];

  // Fetch all Q2 deals with lead sources
  const { data: deals, error: dealError } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, hubspot_created_at, closed_won_entered_at, deal_stage')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', q2.startDate.toISOString())
    .lte('hubspot_created_at', q2.endDate.toISOString());

  if (dealError) throw new Error(`Failed to fetch deals: ${dealError.message}`);
  const allDeals = deals || [];

  return initiatives.map((init) => {
    const matchingDeals = allDeals.filter((d) =>
      d.lead_source && init.lead_source_values.includes(d.lead_source)
    );

    const closedWonDeals = matchingDeals.filter((d) =>
      d.deal_stage === CLOSED_WON_STAGE_ID || d.closed_won_entered_at
    );

    // Weekly breakdown
    const weekly = new Array(13).fill(0);
    for (const d of matchingDeals) {
      if (d.hubspot_created_at) {
        const weekIdx = Math.floor((new Date(d.hubspot_created_at).getTime() - q2Start.getTime()) / (7 * 86400000));
        if (weekIdx >= 0 && weekIdx < 13) weekly[weekIdx]++;
      }
    }

    const expectedByNow = (init.weekly_lead_pace || 0) * currentWeek;
    let paceStatus: 'ahead' | 'on_pace' | 'behind' = 'on_pace';
    if (matchingDeals.length > expectedByNow * 1.1) paceStatus = 'ahead';
    else if (matchingDeals.length < expectedByNow * 0.9) paceStatus = 'behind';

    return {
      id: init.id,
      name: init.name,
      ownerLabel: init.owner_label || '',
      leadSourceValues: init.lead_source_values,
      q2LeadTarget: init.q2_lead_target || 0,
      q2ArrTarget: Number(init.q2_arr_target) || 0,
      weeklyLeadPace: init.weekly_lead_pace || 0,
      leadsCreated: matchingDeals.length,
      arrGenerated: matchingDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      closedWonARR: closedWonDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      expectedByNow,
      paceStatus,
      weeklyBreakdown: weekly,
    };
  });
}
```

---

## Step 6: Auth Resource Registration

**Modify:** `src/lib/auth/types.ts`

Add the new resource constant and path mapping.

### Changes:

1. In the `RESOURCES` object (around line 48), add:
```typescript
  Q2_COMMAND_CENTER: 'q2_command_center',
```

2. In `getResourceFromPath()`, add before the Q2 goal tracker line (around line 146):
```typescript
  if (pathname.includes('/dashboard/q2-command-center')) return RESOURCES.Q2_COMMAND_CENTER;
```

3. In the API route section (around line 214), add:
```typescript
  if (pathname.includes('/api/command-center')) return RESOURCES.Q2_COMMAND_CENTER;
```

Note: `vp_revops` role already has access to everything via the `hasPermission()` function, so no permission seed data is needed.

---

## Step 7: Verification Script

**Create:** `src/scripts/verify-command-center-foundation.ts`

```typescript
/**
 * Verification script for Command Center Foundation phase.
 *
 * Run: npx tsx src/scripts/verify-command-center-foundation.ts
 *
 * Checks:
 * 1. strategic_initiatives table exists and has seed data
 * 2. deal_forecast_overrides table exists
 * 3. computePacingData() runs without errors
 * 4. computeInitiativeStatus() runs without errors
 * 5. Types compile correctly (if this script runs, they do)
 */

import { createServiceClient } from '@/lib/supabase/client';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import { computeLikelihoodTier } from '@/lib/command-center/config';

async function main() {
  const supabase = createServiceClient();
  let passed = 0;
  let failed = 0;

  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  console.log('\n=== Command Center Foundation Verification ===\n');

  // 1. Check strategic_initiatives table
  console.log('1. strategic_initiatives table');
  const { data: initData, error: initError } = await supabase
    .from('strategic_initiatives')
    .select('*');
  check('Table exists', !initError, initError?.message);
  check('Has seed data', (initData?.length || 0) > 0, `Found ${initData?.length || 0} rows`);

  // 2. Check deal_forecast_overrides table
  console.log('\n2. deal_forecast_overrides table');
  const { error: overrideError } = await supabase
    .from('deal_forecast_overrides')
    .select('id')
    .limit(1);
  check('Table exists', !overrideError, overrideError?.message);

  // 3. Compute pacing data
  console.log('\n3. computePacingData()');
  try {
    const goalData = await computeQ2GoalTrackerData(supabase);
    const pacing = await computePacingData(supabase, goalData);
    check('Runs without error', true);
    check('Returns weekly rows', pacing.weeklyRows.length === 13, `Got ${pacing.weeklyRows.length} rows`);
    check('Returns source breakdown', pacing.sourceBreakdown.length > 0, `Got ${pacing.sourceBreakdown.length} sources`);
    console.log(`    Total leads created: ${pacing.totalLeadsCreated}`);
    console.log(`    Total leads required: ${pacing.totalLeadsRequired}`);
  } catch (e) {
    check('Runs without error', false, (e as Error).message);
  }

  // 4. Compute initiative status
  console.log('\n4. computeInitiativeStatus()');
  try {
    const initiatives = await computeInitiativeStatus(supabase);
    check('Runs without error', true);
    check('Returns initiatives', initiatives.length > 0, `Got ${initiatives.length} initiatives`);
    for (const init of initiatives) {
      console.log(`    ${init.name}: ${init.leadsCreated} leads, ${init.paceStatus}`);
    }
  } catch (e) {
    check('Runs without error', false, (e as Error).message);
  }

  // 5. Config functions
  console.log('\n5. Config');
  check('computeLikelihoodTier (on_track, 85)', computeLikelihoodTier(85, 'on_track', null) === 'highly_likely');
  check('computeLikelihoodTier (null, 45)', computeLikelihoodTier(45, null, null) === 'unlikely');
  check('computeLikelihoodTier (stalled, 30)', computeLikelihoodTier(30, 'stalled', null) === 'unlikely');

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
```

---

## Verification Checklist

After executing this phase, the agent should verify:

1. **Migration applied:** `strategic_initiatives` and `deal_forecast_overrides` tables exist in Supabase
2. **Run verification script:** `npx tsx src/scripts/verify-command-center-foundation.ts` — all checks pass
3. **Build succeeds:** `npm run build` — no TypeScript errors
4. **Auth resource registered:** `Q2_COMMAND_CENTER` exists in `RESOURCES` object
5. **Cron scheduled:** `vercel.json` includes `compute-deal-intelligence` at `"30 2 * * *"`
6. **Cron has logging:** The deal intelligence cron route writes to `workflow_runs` on start, completion, and failure
7. **DeepSeek hardcoded:** `getDeepSeekModel()` is exported from `src/lib/ai/provider.ts` and used by the deal intelligence LLM path

---

## What Phase 1 Depends On From This Phase

Phase 1 (`02-phase-1-pacing.md`) will import:
- `CommandCenterResponse`, `PacingData`, `InitiativeStatus`, and all types from `src/lib/command-center/types.ts`
- `computePacingData()` from `src/lib/command-center/compute-pacing.ts`
- `computeInitiativeStatus()` from `src/lib/command-center/compute-initiatives.ts`
- `Q2_TEAM_TARGET` from `src/lib/command-center/config.ts`
- `RESOURCES.Q2_COMMAND_CENTER` from `src/lib/auth/types.ts`
- `computeQ2GoalTrackerData()` from `src/lib/q2-goal-tracker/compute.ts` (existing)

---

## Step 8: Deal Intelligence Cron — Scheduling, Logging, Model, Sync Ordering

The existing `compute-deal-intelligence` cron at `src/app/api/cron/compute-deal-intelligence/route.ts` has several gaps that must be fixed in this Foundation phase:

1. **Not scheduled** — it's not in `vercel.json`, so it never runs automatically
2. **No workflow logging** — doesn't write to `workflow_runs` table (every other cron does)
3. **Wrong model** — the LLM phase uses `getModel()` which reads env vars, not hardcoded to DeepSeek
4. **No sync dependency** — doesn't ensure HubSpot data is fresh before analyzing

### 8a. Update the cron route

**Modify:** `src/app/api/cron/compute-deal-intelligence/route.ts`

Add workflow_runs logging following the exact pattern from other crons (sync-hubspot, hot-tracker, etc.):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { computeAllDealIntelligence } from '@/lib/intelligence/deal-rules';
import { analyzeDealIntelligence, getDealsNeedingLLMAnalysis } from '@/lib/intelligence/deal-llm';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();
  const startTime = Date.now();

  // Log workflow start
  await supabase.from('workflow_runs').insert({
    id: workflowId,
    workflow_name: 'compute-deal-intelligence',
    status: 'running',
  });

  try {
    // Phase 1: Rules engine (fast, no LLM)
    console.log('[Deal Intelligence] Phase 1: Rules engine...');
    const phase1Result = await computeAllDealIntelligence();
    console.log(`[Deal Intelligence] Phase 1 complete: ${phase1Result.processed} deals, ${phase1Result.errors} errors`);

    // Phase 2: LLM analysis on deals that need it
    console.log('[Deal Intelligence] Phase 2: LLM analysis...');
    const dealIds = await getDealsNeedingLLMAnalysis();
    console.log(`[Deal Intelligence] ${dealIds.length} deals need LLM analysis`);

    let llmSuccess = 0;
    let llmErrors = 0;
    const llmErrorDetails: string[] = [];

    // Process sequentially to avoid rate limits (DeepSeek)
    for (const dealId of dealIds) {
      const result = await analyzeDealIntelligence(dealId);
      if (result.success) {
        llmSuccess++;
      } else {
        llmErrors++;
        llmErrorDetails.push(`${dealId}: ${result.error}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Deal Intelligence] Phase 2 complete: ${llmSuccess} analyzed, ${llmErrors} errors, ${duration}ms total`);

    // Log workflow completion
    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        phase1: { processed: phase1Result.processed, errors: phase1Result.errors },
        phase2: { dealsQueued: dealIds.length, analyzed: llmSuccess, errors: llmErrors, errorDetails: llmErrorDetails.slice(0, 10) },
        durationMs: duration,
      },
    }).eq('id', workflowId);

    return NextResponse.json({
      success: true,
      phase1: { processed: phase1Result.processed, errors: phase1Result.errors },
      phase2: { dealsQueued: dealIds.length, analyzed: llmSuccess, errors: llmErrors },
      durationMs: duration,
    });
  } catch (error) {
    console.error('[Deal Intelligence] Fatal error:', error);
    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Deal intelligence computation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

**Key decisions:**
- Deals are processed **sequentially** (not parallel) to avoid DeepSeek rate limits. With ~30-40 open deals and ~10-15 needing LLM refresh, this takes a few minutes — fine for a scheduled job.
- Error details are captured per-deal so you can see which specific deal failed and why.
- The `result` JSONB column stores both Phase 1 and Phase 2 metrics.

### 8b. Hardcode DeepSeek for deal intelligence LLM

**Modify:** `src/lib/intelligence/deal-llm.ts`

The `analyzeDealIntelligence()` function calls `analyzeDealCoach()` which uses `getModel()` (reads env vars). Instead, the deal coach analysis should use DeepSeek explicitly for Command Center work.

**Approach:** The deal coach (`src/app/api/queues/deal-coach/analyze/analyze-core.ts`) calls `getModel()`. Rather than modifying the shared deal coach (which other features use), create a thin wrapper or pass a model parameter.

Check how `analyzeDealCoach` accepts its model — if it uses `getModel()` internally, the cleanest fix is to update `src/lib/ai/provider.ts` to add a `getDeepSeekModel()` export (it already exists in `src/lib/ai/passes/models.ts` — just re-export it from the main provider):

```typescript
// In src/lib/ai/provider.ts, add:
export function getDeepSeekModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');

  const deepseek = createDeepSeek({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return deepseek('deepseek/deepseek-v3.2');
}
```

Then update `deal-llm.ts` and the deal coach to accept an optional model parameter, defaulting to `getModel()` for existing callers but passing `getDeepSeekModel()` from the deal intelligence cron path.

**The exact implementation depends on how `analyzeDealCoach` and `analyzePreDemoEffort` accept their model.** The executing agent should read those functions, find where `getModel()` or `generateText` is called, and add an optional `model` parameter that the deal intelligence cron passes as `getDeepSeekModel()`.

### 8c. Schedule in vercel.json — after sync-hubspot

**Modify:** `vercel.json`

Add the deal intelligence cron **after** sync-hubspot completes. Sync runs at 2:00 AM and typically takes 2-5 minutes. Schedule deal intelligence at **2:30 AM** to ensure fresh data:

```json
{
  "path": "/api/cron/compute-deal-intelligence",
  "schedule": "30 2 * * *"
}
```

**Ordering:**
- 2:00 AM — `sync-hubspot` (pulls fresh deal data from HubSpot into Supabase)
- 2:30 AM — `sync-companies`
- 2:30 AM — `compute-deal-intelligence` (rules + LLM on freshly synced data)
- 3:00 AM — everything else (hot-tracker at 3:30, demo-tracker at 4:00)

This ensures the analysis always runs on the most recent HubSpot data.

### 8d. Verification

Update the foundation verification script to also check:
```typescript
// Check workflow_runs table can accept deal intelligence entries
const testId = crypto.randomUUID();
const { error: insertError } = await supabase.from('workflow_runs').insert({
  id: testId,
  workflow_name: 'compute-deal-intelligence',
  status: 'pending',
});
check('workflow_runs accepts deal-intelligence entries', !insertError, insertError?.message);

// Clean up test row
await supabase.from('workflow_runs').delete().eq('id', testId);
```

---

## Important Notes for the Executing Agent

- The `lead_source_values` in the seed data (`'Channel Partner'`, `'Co-Destiny'`) may not exactly match what's in HubSpot. The user should verify and update after the migration runs. The initiative tracker will show 0 leads if the values don't match — that's correct behavior, not a bug.
- The `AE_TARGETS` and `Q2_TEAM_TARGET` values are maintained in `src/lib/q2-goal-tracker/compute.ts`. The config.ts in command-center references the same `925000` value. If targets change, both need updating.
- Do not create API routes or UI in this phase. Those come in Phase 1.
- The deal intelligence cron processes deals **sequentially** to respect DeepSeek rate limits. This is intentional — don't parallelize it.
- The model is **hardcoded to `deepseek/deepseek-v3.2`** for deal intelligence. Do not use `getModel()` which reads env vars. Use the explicit `getDeepSeekModel()` function.
