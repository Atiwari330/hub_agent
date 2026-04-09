# Phase 3: Forecast Engine + Human Overrides + Executive Summary

## Git & Execution Rules

1. **Work on branch `feature/q2-command-center`** — run `git checkout feature/q2-command-center` (it already exists from prior phases)
2. **DO NOT merge to `main`** — the user will approve the merge when all phases are complete
3. **Run all verification steps** at the end of this doc before declaring done
4. **Commit all work** with a message like: `feat: Q2 Command Center — Phase 3 (forecast engine, overrides, executive summary)`
5. **STOP after this phase** — do not continue. Report what was built and verification results to the user. This is the final phase.

## Context

**What exists from Foundation + Phase 1 + Phase 2:**
- DB tables: `strategic_initiatives` (with seed data), `deal_forecast_overrides` (empty, ready for use)
- Full Command Center page at `/dashboard/q2-command-center` with:
  - Hero summary (target, closed-won, pipeline, gap, on/off track)
  - Pacing section (leads/deals by source and week)
  - Initiative tracker (per-initiative progress)
  - Weekly operating table (13 weeks)
  - Deal intelligence table (sortable/filterable, grades, likelihood)
  - Deal detail slide-over (scores, timeline, AI assessment, coaching, issues)
  - AE execution section (per-AE cards with grade distribution)
- Working API endpoints:
  - `GET /api/command-center` — pacing + initiatives
  - `GET /api/command-center/deals` — deal list with intelligence + overrides
  - `GET /api/command-center/deals/[dealId]` — deal detail
  - `GET /api/command-center/ae-execution` — per-AE metrics
- Types: All types from `src/lib/command-center/types.ts` including `ForecastSummary`, `LikelihoodTier`, `DealForecastItem`
- Config: `LIKELIHOOD_WEIGHTS`, `computeLikelihoodTier()` from `src/lib/command-center/config.ts`

**What this phase adds:**
- Forecast computation engine (pure function — no DB, no LLM)
- Override API (create/delete overrides on individual deals)
- Forecast API endpoint
- Executive summary API endpoint (deterministic + optional LLM narrative)
- Forecast section component (visual breakdown by likelihood tier)
- Executive summary component (key insights, where to focus)
- Override form in deal detail panel
- Enhanced hero summary with forecast-derived projected outcome

**IMPORTANT: This is additive.** No existing files outside of `src/components/command-center/` and `src/lib/command-center/` are modified.

**Maps to product brief sections:** 10 (Rolling Forecast), 11 (Human Override), 12 (Intelligent Summary)

---

## Step 1: Forecast Computation Engine

**Create:** `src/lib/command-center/compute-forecast.ts`

This is a **pure function** — no database access, no LLM calls. It takes a list of deals (with intelligence scores and overrides) and produces a forecast summary.

**Logic:**

```typescript
import { LIKELIHOOD_WEIGHTS } from './config';
import type { DealForecastItem, ForecastSummary, LikelihoodTier } from './types';

export function computeRollingForecast(
  deals: DealForecastItem[],
  closedWonARR: number,
  target: number,
): ForecastSummary {
  // Initialize tier accumulators
  const tiers: ForecastSummary['tiers'] = {
    highly_likely: { count: 0, rawARR: 0, weightedARR: 0 },
    likely: { count: 0, rawARR: 0, weightedARR: 0 },
    possible: { count: 0, rawARR: 0, weightedARR: 0 },
    unlikely: { count: 0, rawARR: 0, weightedARR: 0 },
    insufficient_data: { count: 0, rawARR: 0, weightedARR: 0 },
  };

  for (const deal of deals) {
    // Use override if it exists, otherwise use AI-derived tier
    const effectiveTier = deal.override?.likelihood as LikelihoodTier || deal.likelihoodTier;
    const effectiveAmount = deal.override?.amount ?? deal.amount;
    const weight = LIKELIHOOD_WEIGHTS[effectiveTier] ?? LIKELIHOOD_WEIGHTS.insufficient_data;

    const tier = tiers[effectiveTier] || tiers.insufficient_data;
    tier.count++;
    tier.rawARR += effectiveAmount;
    tier.weightedARR += effectiveAmount * weight;
  }

  const totalWeighted = Object.values(tiers).reduce((sum, t) => sum + t.weightedARR, 0);
  const projectedTotal = closedWonARR + totalWeighted;
  const gap = Math.max(0, target - projectedTotal);

  // Confidence based on how much of the forecast comes from high-confidence tiers
  const highConfidenceARR = tiers.highly_likely.weightedARR + tiers.likely.weightedARR;
  const confidenceRatio = totalWeighted > 0 ? highConfidenceARR / totalWeighted : 0;
  let confidenceLevel: 'high' | 'medium' | 'low' = 'medium';
  if (confidenceRatio >= 0.6 && projectedTotal >= target * 0.9) confidenceLevel = 'high';
  else if (confidenceRatio < 0.3 || projectedTotal < target * 0.7) confidenceLevel = 'low';

  return {
    totalWeighted: Math.round(totalWeighted),
    target,
    gap: Math.round(gap),
    tiers,
    closedWonARR,
    projectedTotal: Math.round(projectedTotal),
    confidenceLevel,
  };
}
```

**Testing:** This is a pure function — it can be tested with mock data. The verification script (Step 8) will test it.

---

## Step 2: Override API Endpoint

**Create:** `src/app/api/command-center/deals/[dealId]/override/route.ts`

Handles creating and deleting human overrides.

### POST — Create/update override

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { z } from 'zod';

const OverrideSchema = z.object({
  override_likelihood: z.enum(['highly_likely', 'likely', 'possible', 'unlikely', 'insufficient_data']),
  override_amount: z.number().nullable().optional(),
  override_close_date: z.string().nullable().optional(),
  override_reason: z.string().min(1, 'Reason is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  // Get the authenticated user's email from authResult
  // Check how other POST endpoints access the user — the auth system returns user info

  const { dealId } = await params;
  const body = await request.json();
  const parsed = OverrideSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // First, get the current AI likelihood to store as original_likelihood
  const { data: intelligence } = await supabase
    .from('deal_intelligence')
    .select('overall_score, llm_status, buyer_sentiment')
    .eq('hubspot_deal_id', dealId)
    .single();

  // Compute original likelihood from AI scores
  const originalLikelihood = intelligence
    ? computeLikelihoodTier(intelligence.overall_score, intelligence.llm_status, intelligence.buyer_sentiment)
    : 'insufficient_data';

  // Upsert override
  const { error } = await supabase
    .from('deal_forecast_overrides')
    .upsert({
      hubspot_deal_id: dealId,
      original_likelihood: originalLikelihood,
      override_likelihood: parsed.data.override_likelihood,
      override_amount: parsed.data.override_amount ?? null,
      override_close_date: parsed.data.override_close_date ?? null,
      override_reason: parsed.data.override_reason,
      overridden_by: /* user email from auth */'',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'hubspot_deal_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

**Important:** The `overridden_by` field needs the authenticated user's email. Check how the auth system returns user info — look at how other routes that need user identity access it (e.g., check if `checkApiAuth` returns user data, or if there's a `getUser()` helper).

### DELETE — Remove override

```typescript
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from('deal_forecast_overrides')
    .delete()
    .eq('hubspot_deal_id', dealId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

---

## Step 3: Forecast API Endpoint

**Create:** `src/app/api/command-center/forecast/route.ts`

Combines deal intelligence data with overrides to produce a rolling forecast.

**Logic:**
1. Fetch deals from `/api/command-center/deals` internally (or duplicate the query — prefer reusing the compute logic)
2. Get closed-won ARR from Q2 actuals (from `computeQ2GoalTrackerData()`)
3. Call `computeRollingForecast(deals, closedWonARR, target)`
4. Return `ForecastSummary`

```typescript
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { computeLikelihoodTier, Q2_TEAM_TARGET } from '@/lib/command-center/config';
// ... fetch deals and overrides, compute forecast, return

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  // Fetch goal tracker data for closed-won ARR
  const goalTracker = await computeQ2GoalTrackerData(supabase);
  const closedWonARR = goalTracker.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);

  // Fetch deals with intelligence (reuse the same query from /api/command-center/deals)
  // IMPORTANT: Only include Q2-relevant deals (close_date within Q2, null, or already closed-won in Q2)
  // Deals with close_date after Q2 are EXCLUDED — AE has flagged them as not closing this quarter
  // ... build DealForecastItem[] array with likelihoodTier computed

  // Compute forecast
  const forecast = computeRollingForecast(deals, closedWonARR, Q2_TEAM_TARGET);

  return NextResponse.json(forecast);
}
```

**Note:** The deal fetching logic will be duplicated from the deals endpoint. Consider extracting the shared deal-fetching logic into a function in `src/lib/command-center/` if it's more than ~20 lines. But don't over-abstract — if it's simpler to inline, inline it.

---

## Step 4: Executive Summary API Endpoint

**Create:** `src/app/api/command-center/executive-summary/route.ts`

Generates a structured summary of the current quarter state. **Primarily deterministic** — uses the data already computed. Optional LLM pass for a natural language narrative.

**Deterministic insights to generate:**

```typescript
interface ExecutiveSummaryResponse {
  insights: Insight[];
  narrative: string | null; // LLM-generated (optional, can be null in v1)
}

interface Insight {
  category: 'forecast' | 'pacing' | 'initiatives' | 'deals' | 'execution';
  status: 'on_track' | 'watch' | 'action_needed';
  title: string;      // e.g., "Pipeline is 25% below target pace"
  detail: string;     // 1-2 sentences of context
}
```

**Logic to generate insights:**

1. **Forecast vs target:**
   - If `projectedTotal >= target * 0.9` → on_track: "On pace to hit Q2 target"
   - If `projectedTotal >= target * 0.7` → watch: "Pipeline tracking X% below target"
   - If `projectedTotal < target * 0.7` → action_needed: "Significant gap to Q2 target"

2. **Lead pacing:**
   - If `totalLeadsCreated >= totalLeadsRequired * (currentWeek/13) * 0.9` → on_track
   - Else → behind pace insight

3. **Initiative health:**
   - For each initiative that's `behind` → action_needed insight

4. **At-risk deals:**
   - Count deals with grade D or F
   - If > 30% of pipeline → action_needed: "X deals (Y% of pipeline) need attention"

5. **AE execution:**
   - Identify AEs with avg score < 50 → watch/action_needed

6. **Top risks:**
   - The 3 largest deals (by amount) that are `unlikely` or `at_risk`

**Optional LLM narrative:**

If you want to add a natural language synthesis, use `generateText` from Vercel AI SDK:

```typescript
import { generateText } from 'ai';
// Use the same AI provider setup as existing agent code
// See src/lib/ai/provider.ts for the provider configuration

const { text } = await generateText({
  model: /* provider */,
  prompt: `Given these quarterly metrics, write a 3-4 sentence executive summary of where the quarter stands and what needs attention: ${JSON.stringify(insights)}`,
});
```

**However:** The deterministic insights alone are valuable. The LLM narrative is genuinely optional — implement only if the insights feel incomplete without it. The product brief says "calculation-first, AI-assisted" — don't add LLM just because you can.

---

## Step 5: Forecast Section Component

**Create:** `src/components/command-center/forecast-section.tsx`

Visual representation of the rolling forecast.

**Displays:**

### 5a. Forecast Bar
A horizontal stacked bar showing:
- Closed Won (solid green) — already in the bank
- Highly Likely (dark green, slightly transparent)
- Likely (green)
- Possible (yellow)
- Unlikely (light gray)
- Insufficient Data (dashed outline)

With a target line (vertical red/black line at the target amount).

**Implementation:** Use Recharts `BarChart` with stacked bars, or a simple CSS-based stacked bar (may be cleaner for this use case).

### 5b. Tier Breakdown Table
| Tier | Deals | Raw ARR | Weight | Weighted ARR |
|------|-------|---------|--------|--------------|
| Highly Likely | 5 | $200K | 85% | $170K |
| Likely | 8 | $300K | 65% | $195K |
| ... | ... | ... | ... | ... |
| **Total** | | | | **$XXX** |

### 5c. Confidence Indicator
Show confidence level (high/medium/low) with explanation:
- High: "60%+ of weighted forecast from highly likely or likely deals"
- Medium: "Mixed confidence — significant portion in possible or below"
- Low: "Most of forecast from uncertain deals"

**Props:** Accepts `forecast: ForecastSummary` from the parent.

---

## Step 6: Override Form in Deal Detail Panel

**Modify:** `src/components/command-center/deal-detail-panel.tsx`

Replace the Phase 2 override placeholder with a working form.

**Override UI:**

1. If no override exists:
   - Show "Override AI Judgment" button
   - Clicking it expands an inline form

2. Override form:
   - **Likelihood tier:** Select dropdown with 5 options (highly_likely, likely, possible, unlikely, insufficient_data)
   - **Adjusted amount:** Optional number input (pre-filled with current deal amount)
   - **Reason:** Required textarea
   - Save button, Cancel button

3. If override already exists:
   - Show override details: "Overridden to [tier] by [email] on [date]"
   - Show reason
   - Show original AI judgment for comparison
   - "Remove Override" button (calls DELETE endpoint)
   - "Edit Override" button (re-opens the form)

4. After saving/removing:
   - Optimistically update the UI
   - Refresh the forecast section (the parent component should re-fetch forecast data)

**API calls:**
- Save: `POST /api/command-center/deals/[dealId]/override`
- Delete: `DELETE /api/command-center/deals/[dealId]/override`

---

## Step 7: Executive Summary Component

**Create:** `src/components/command-center/executive-summary.tsx`

Displays key insights at the top of the page (or as a dedicated section).

**Layout:**
- List of insight cards, each showing:
  - Status icon/badge (green check / yellow warning / red alert)
  - Category label (small, muted)
  - Title (bold, primary)
  - Detail text (secondary)

- Grouped by status: action_needed first, then watch, then on_track
- Max 6-8 insights shown (the most important ones)

**Optional:** If LLM narrative exists, show it as a paragraph above the insight cards.

**Props:** Fetches from `/api/command-center/executive-summary` on mount.

**Placement in the page:** This should appear near the top, below the hero summary but above the pacing section. It's the "what matters right now" section.

---

## Step 8: Enhance Hero Summary

**Modify:** `src/components/command-center/hero-summary.tsx`

Add forecast-derived data to the hero:

1. Replace or supplement the "Weighted Pipeline" metric with "Projected Outcome" from `forecast.projectedTotal`
2. Add confidence indicator (high/medium/low badge)
3. The gap calculation should use the forecast-derived projection, not just weighted pipeline

**Data flow:** The parent `command-center-view.tsx` fetches the forecast and passes it to the hero.

---

## Step 9: Integrate into Command Center View

**Modify:** `src/components/command-center/command-center-view.tsx`

Add the new sections and data fetching:

```
<HeroSummary goalTracker={...} forecast={forecast} />
<ExecutiveSummary />
<PacingSection />
<InitiativeTracker />
<WeeklyOperatingTable />
<ForecastSection forecast={forecast} />
<AEExecutionSection />
<DealIntelligenceTable onSelectDeal={setSelectedDeal} />
{selectedDeal && <DealDetailPanel dealId={selectedDeal} onClose={...} onOverrideChange={refetchForecast} />}
```

**New data fetches:**
- `GET /api/command-center/forecast` — for forecast data
- `GET /api/command-center/executive-summary` — for insights

**Override callback:** When an override is saved/deleted in the deal detail panel, the forecast section should refresh. Pass a callback like `onOverrideChange` that triggers a re-fetch of the forecast endpoint.

---

## Step 10: Verification Script

**Create:** `src/scripts/verify-command-center-forecast.ts`

```typescript
/**
 * Verification script for Command Center Phase 3 (Forecast Engine).
 *
 * Run: npx tsx src/scripts/verify-command-center-forecast.ts
 */

import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { LIKELIHOOD_WEIGHTS } from '@/lib/command-center/config';
import type { DealForecastItem, ForecastSummary } from '@/lib/command-center/types';

function check(label: string, ok: boolean, detail?: string) {
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ': ' + detail : ''}`);
  return ok ? 1 : 0;
}

function main() {
  let passed = 0;
  console.log('\n=== Forecast Engine Verification ===\n');

  // Mock deals for testing
  const mockDeals: Partial<DealForecastItem>[] = [
    { hubspotDealId: '1', amount: 100000, likelihoodTier: 'highly_likely', override: null },
    { hubspotDealId: '2', amount: 50000, likelihoodTier: 'likely', override: null },
    { hubspotDealId: '3', amount: 75000, likelihoodTier: 'possible', override: null },
    { hubspotDealId: '4', amount: 30000, likelihoodTier: 'unlikely', override: null },
    { hubspotDealId: '5', amount: 40000, likelihoodTier: 'insufficient_data', override: null },
  ];

  const forecast = computeRollingForecast(mockDeals as DealForecastItem[], 50000, 925000);

  console.log('1. computeRollingForecast() with mock data');
  passed += check('Returns ForecastSummary', !!forecast);
  passed += check('Has all tiers', Object.keys(forecast.tiers).length === 5);
  passed += check('Closed won ARR correct', forecast.closedWonARR === 50000);
  passed += check('Target correct', forecast.target === 925000);

  // Verify weighted calculation
  const expectedWeighted =
    100000 * LIKELIHOOD_WEIGHTS.highly_likely +
    50000 * LIKELIHOOD_WEIGHTS.likely +
    75000 * LIKELIHOOD_WEIGHTS.possible +
    30000 * LIKELIHOOD_WEIGHTS.unlikely +
    40000 * LIKELIHOOD_WEIGHTS.insufficient_data;
  passed += check('Weighted ARR correct', forecast.totalWeighted === Math.round(expectedWeighted),
    `Expected ${Math.round(expectedWeighted)}, got ${forecast.totalWeighted}`);
  passed += check('Projected total = closedWon + weighted', forecast.projectedTotal === 50000 + Math.round(expectedWeighted));
  passed += check('Gap = max(0, target - projected)', forecast.gap === Math.max(0, 925000 - forecast.projectedTotal));

  // Test override
  console.log('\n2. Override handling');
  const dealsWithOverride: Partial<DealForecastItem>[] = [
    {
      hubspotDealId: '1',
      amount: 100000,
      likelihoodTier: 'unlikely',
      override: { likelihood: 'highly_likely', amount: 120000, reason: 'CEO confirmed', overriddenBy: 'adi', overriddenAt: '' },
    },
  ];

  const forecastOverride = computeRollingForecast(dealsWithOverride as DealForecastItem[], 0, 925000);
  passed += check('Override likelihood used', forecastOverride.tiers.highly_likely.count === 1);
  passed += check('Override amount used', forecastOverride.tiers.highly_likely.rawARR === 120000);
  passed += check('Original tier empty', forecastOverride.tiers.unlikely.count === 0);

  console.log(`\n=== Results: ${passed} passed ===\n`);
}

main();
```

---

## Verification Checklist

After executing this phase:

1. **Forecast engine tests:**
   ```bash
   npx tsx src/scripts/verify-command-center-forecast.ts
   # All checks should pass
   ```

2. **Override API:**
   ```bash
   # Get a deal ID
   DEAL_ID=$(curl -s http://localhost:3000/api/command-center/deals | jq -r '.deals[0].hubspotDealId')

   # Create override
   curl -X POST http://localhost:3000/api/command-center/deals/$DEAL_ID/override \
     -H 'Content-Type: application/json' \
     -d '{"override_likelihood":"likely","override_reason":"CEO confirmed verbally"}'
   # Should return {"success": true}

   # Verify override appears in forecast
   curl http://localhost:3000/api/command-center/forecast | jq '.tiers.likely'

   # Delete override
   curl -X DELETE http://localhost:3000/api/command-center/deals/$DEAL_ID/override
   ```

3. **Forecast API:**
   ```bash
   curl http://localhost:3000/api/command-center/forecast | jq '{projectedTotal, gap, confidenceLevel}'
   ```

4. **Executive summary API:**
   ```bash
   curl http://localhost:3000/api/command-center/executive-summary | jq '.insights | length'
   ```

5. **Full UI flow:**
   - Navigate to `/dashboard/q2-command-center`
   - Executive summary insights appear near top
   - Forecast section shows stacked bar and tier breakdown
   - Hero summary shows projected outcome and confidence
   - Click a deal → override form works → forecast updates after save
   - Override audit trail visible in deal detail

6. **Existing pages untouched:** `/dashboard/q2-goal-tracker` works exactly as before

7. **Build succeeds:** `npm run build`

---

## Final State

After all 4 phases, the Command Center answers:
- Are we on pace to hit Q2 ARR? → Hero summary + forecast
- Are enough leads being created by channel? → Pacing section
- Are enough deals being created? → Pacing + weekly operating table
- Which channels are working / falling behind? → Source breakdown
- Are strategic initiatives producing? → Initiative tracker
- Are AEs working deals effectively? → AE execution cards
- Which deals are truly healthy? → Deal intelligence table + detail
- Which deals are likely to close? → Likelihood tiers
- What does the real rolling forecast look like? → Forecast section
- Where should leadership focus? → Executive summary insights
