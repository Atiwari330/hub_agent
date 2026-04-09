# Phase 2: Deal Intelligence Surface + Deal Detail + AE Execution Review

## Git & Execution Rules

1. **Work on branch `feature/q2-command-center`** — run `git checkout feature/q2-command-center` (it already exists from prior phases)
2. **DO NOT merge to `main`** — the user will approve the merge when all phases are complete
3. **Run all verification steps** at the end of this doc before declaring done
4. **Commit all work** with a message like: `feat: Q2 Command Center — Phase 2 (deal intelligence, deal detail, AE execution)`
5. **STOP after this phase** — do not continue to Phase 3. Report what was built and verification results to the user.

## Context

**What exists from Foundation + Phase 1:**
- DB tables: `strategic_initiatives`, `deal_forecast_overrides`
- Types: `src/lib/command-center/types.ts` — all types including `DealForecastItem`, `AEExecutionSummary`, `LikelihoodTier`
- Config: `src/lib/command-center/config.ts` — `computeLikelihoodTier()`, `LIKELIHOOD_WEIGHTS`
- Working API: `GET /api/command-center` returning `CommandCenterResponse`
- Working page: `/dashboard/q2-command-center` with hero summary, pacing, initiatives, weekly table
- Working components: `command-center-view.tsx`, `hero-summary.tsx`, `pacing-section.tsx`, `initiative-tracker.tsx`, `weekly-operating-table.tsx`
- Sidebar link to Command Center

**What this phase adds:**
- Deal intelligence table (sortable/filterable, surfaces existing deal_intelligence scores)
- Deal detail slide-over panel (click a deal row to see full intelligence)
- AE execution review section (per-AE performance cards)
- 3 new API endpoints for deal data, deal detail, and AE execution

**IMPORTANT: This is additive.** The existing Q2 Goal Tracker and deal intelligence queue pages remain untouched. This phase reads from the `deal_intelligence` table (already populated by the existing cron job) and the `deal_forecast_overrides` table (created in Foundation).

**Maps to product brief sections:** 6 (Timeline Reconstruction), 7 (AE Execution Review), 8 (AI-Assisted Interpretation), 9 (Likelihood-to-Close)

---

## Existing Code to Reuse (READ, DON'T MODIFY)

### Deal Intelligence Query Pattern
**File:** `src/app/api/queues/deal-intelligence/route.ts`

This file contains the `DealIntelligenceItem` interface and the Supabase query that fetches deal intelligence rows joined with deals. Study the query pattern — the command center deals endpoint should use a similar query.

Key details:
- Joins `deal_intelligence` with `deals` table on `hubspot_deal_id`
- Filters to open stages using `ALL_OPEN_STAGE_IDS` from `src/lib/hubspot/stage-config.ts`
- Filters to target pipeline using `SYNC_CONFIG.TARGET_PIPELINE_ID` from `src/lib/hubspot/sync-config.ts`
- Left-joins `pre_demo_coach_analyses` for coaching narratives
- Returns grade distribution counts

### Deal Intelligence Scoring
**File:** `src/lib/intelligence/deal-rules.ts`

Contains `DealIntelligenceRow` type and scoring logic:
- Dimension weights: Hygiene 15%, Momentum 30%, Engagement 35%, Risk 20%
- Grades: A=85-100, B=70-84, C=55-69, D=40-54, F=0-39
- `computeGrade()`, `computeOverallScore()` functions

### Stage Configuration
**File:** `src/lib/hubspot/stage-config.ts`

Contains `SALES_PIPELINE_STAGES` with all stage IDs and labels, plus `ALL_OPEN_STAGE_IDS` and `PRE_DEMO_STAGE_IDS` arrays.

### Likelihood Tier Mapping
**File:** `src/lib/command-center/config.ts` (created in Foundation)

`computeLikelihoodTier(overallScore, llmStatus, buyerSentiment)` maps existing intelligence scores to a forecast likelihood tier.

---

## Step 1: Deals API Endpoint

**Create:** `src/app/api/command-center/deals/route.ts`

Returns all Q2-relevant deals enriched with intelligence scores and any human overrides.

**Logic:**
1. Fetch from `deal_intelligence` table (same query pattern as `src/app/api/queues/deal-intelligence/route.ts`)
2. Filter to Q2-relevant deals only:
   - Open deals in sales pipeline **with close_date within Q2 (Apr 1 – Jun 30, 2026) OR close_date is null**
   - Plus deals already closed-won in Q2 (closed_won_entered_at within Q2)
   - **Exclude deals with close_date after Q2** — if an AE pushed the close date to July+, they've flagged it as not a Q2 deal and it should not appear in the Q2 forecast or command center
3. Left-join `deal_forecast_overrides` on `hubspot_deal_id`
4. For each deal, compute `likelihoodTier` using `computeLikelihoodTier()` from config
5. Return as `DealForecastItem[]`

**Key implementation details:**
```typescript
import { RESOURCES } from '@/lib/auth';
import { checkApiAuth } from '@/lib/auth/api';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { ALL_OPEN_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { computeLikelihoodTier } from '@/lib/command-center/config';
import type { DealForecastItem } from '@/lib/command-center/types';
```

**Query approach:**
1. Fetch `deal_intelligence` rows where pipeline = SYNC_CONFIG.TARGET_PIPELINE_ID
2. Join with `deals` table to get `close_date` and `closed_won_entered_at`
3. Filter: include deal if ANY of these are true:
   - `close_date` is within Q2 2026 (>= '2026-04-01' AND <= '2026-06-30')
   - `close_date` is null (hasn't been set — include but flag as hygiene issue)
   - `closed_won_entered_at` is within Q2 (already won this quarter)
4. **Exclude** deals where `close_date` is after Q2 (> '2026-06-30') — the AE has signaled this won't close in Q2
5. Separately fetch all `deal_forecast_overrides` and merge by hubspot_deal_id
6. Map each row to `DealForecastItem`, computing `likelihoodTier`

**Why this matters:** When an AE pushes a close date into Q3+, they're explicitly saying "this deal isn't closing this quarter." Including it would inflate the Q2 pipeline and forecast, making the dashboard unreliable. The existing deal intelligence queue scores ALL open deals (no date filter) — the command center is specifically scoped to Q2.

**Response shape:**
```typescript
{
  deals: DealForecastItem[];
  counts: {
    total: number;
    byGrade: { A: number; B: number; C: number; D: number; F: number };
    byLikelihood: { highly_likely: number; likely: number; possible: number; unlikely: number; insufficient_data: number };
    withOverrides: number;
  };
}
```

---

## Step 2: Deal Detail API Endpoint

**Create:** `src/app/api/command-center/deals/[dealId]/route.ts`

Returns a single deal's full intelligence, engagement counts, and stage timeline.

**Logic:**
1. Fetch the `deal_intelligence` row by `hubspot_deal_id` (the `[dealId]` param)
2. Fetch the deal row from `deals` table for stage entry timestamps
3. Fetch any override from `deal_forecast_overrides`
4. Build a stage timeline from the deal's `_entered_at` columns:
   - `mql_entered_at`, `discovery_entered_at`, `demo_scheduled_entered_at`, `demo_completed_entered_at`, `proposal_entered_at`, `closed_won_entered_at`
   - Each becomes a timeline entry: `{ stage: string, enteredAt: string | null }`
5. Return enriched detail

**Response shape:**
```typescript
{
  deal: DealForecastItem;    // same shape as list endpoint
  timeline: { stage: string; enteredAt: string | null; label: string }[];
  intelligence: {
    hygieneScore: number;
    momentumScore: number;
    engagementScore: number;
    riskScore: number;
    issues: { type: string; severity: string; message: string }[];
    missingFields: string[];
    llmReasoning: string | null;
    recommendedAction: string | null;
    coaching: {
      situation: string | null;
      nextAction: string | null;
      followUp: string | null;
    } | null;
  };
  override: { ... } | null;
}
```

**No live HubSpot fetch.** All data comes from Supabase (synced daily). The stage timeline is built from the `_entered_at` timestamp columns on the deals table.

---

## Step 3: AE Execution API Endpoint

**Create:** `src/app/api/command-center/ae-execution/route.ts`

Returns per-AE execution metrics computed from deal intelligence data.

**Logic:**
1. Fetch all `deal_intelligence` rows for open deals
2. Group by `owner_id`
3. For each AE, compute:
   - Deal count
   - Average overall score
   - Average grade (mode of grades)
   - Grade distribution (count of A/B/C/D/F)
   - Deals needing attention (D + F grade count)
   - Pipeline ARR (sum of amounts for open deals)
4. Join with AE targets from `src/lib/q2-goal-tracker/compute.ts` (the `AE_TARGETS` constant)
5. Fetch closed-won ARR per AE from deals table

**Response shape:**
```typescript
{
  aeExecutions: AEExecutionSummary[];
}
```

Use the `AEExecutionSummary` type from `src/lib/command-center/types.ts`.

**AE target reference:** The AE_TARGETS map lives in `src/lib/q2-goal-tracker/compute.ts`. You can either:
- Import and re-export it from a shared location
- Or query the `owners` table and match emails to the hardcoded targets

Check how the existing code accesses AE targets and follow the same pattern.

---

## Step 4: Deal Intelligence Table Component

**Create:** `src/components/command-center/deal-intelligence-table.tsx`

A sortable, filterable table that is the main deal inspection surface.

**Columns:**
| Deal Name | Owner | Source | Stage | Amount | Grade | Likelihood | Sentiment | Risk | Override |
|-----------|-------|--------|-------|--------|-------|------------|-----------|------|----------|

**Column details:**
- **Grade:** Colored pill (A=green, B=blue, C=yellow, D=orange, F=red)
- **Likelihood:** Badge showing tier (highly_likely, likely, possible, unlikely, insufficient_data) with tier-appropriate colors
- **Sentiment:** From `buyerSentiment` field (positive/neutral/negative/null)
- **Risk:** From `keyRisk` — truncated to ~30 chars with tooltip for full text
- **Override:** Icon/badge if an override exists on this deal
- **Amount:** Currency formatted

**Filtering:**
- Grade filter: A, B, C, D, F (multi-select buttons)
- Owner filter: dropdown of AE names
- Likelihood filter: tier buttons
- Stage filter: dropdown

**Sorting:** Click column header to sort. Default sort by overall score descending.

**Row click:** Triggers the deal detail panel (Step 5). Pass `hubspotDealId` to the parent which controls the panel.

**Data source:** Fetches from `/api/command-center/deals` on mount. Consider using the parent `command-center-view.tsx` to fetch and pass as props (keeps data flow simple).

---

## Step 5: Deal Detail Slide-Over Panel

**Create:** `src/components/command-center/deal-detail-panel.tsx`

Opens when a deal row is clicked. Slides in from the right (or renders as a side panel).

**Sections within the panel:**

### 5a. Deal Summary Card
- Deal name, owner, amount, stage, close date, lead source
- Days in current stage
- Overall grade (large, colored)
- Likelihood tier badge

### 5b. Intelligence Dimensions
Four horizontal bars showing scores 0-100:
- Hygiene (15% weight)
- Momentum (30% weight)
- Engagement (35% weight)
- Risk (20% weight)

Each bar is color-coded: green (>70), yellow (40-70), red (<40).

### 5c. Stage Timeline
Vertical timeline showing when the deal entered each stage:
- MQL → SQL/Discovery → Demo Scheduled → Demo Completed → Proposal → Closed Won
- Show dates next to each stage
- Highlight the current stage
- Show gaps (e.g., "45 days in Discovery" if the gap is large)

Built from the `timeline` array in the detail API response.

### 5d. AI Assessment
- LLM status + urgency
- Buyer sentiment
- Deal momentum
- Key risk
- Recommended action
- Full reasoning text

If no LLM assessment exists (llm_analyzed_at is null), show: "AI assessment pending — will be available after next analysis run."

### 5e. Coaching (if available)
From pre-demo coach analysis:
- Situation
- Next action
- Follow-up

Only show this section if coaching data exists.

### 5f. Issues List
From the `issues` array — list of flagged problems with severity badges.

### 5g. Override Section (placeholder for Phase 3)
Show current override if one exists (likelihood, amount, reason, who, when).
Phase 3 will add the ability to create/edit overrides from here.

**Close behavior:** X button or click outside to close.

**Data source:** Fetches from `/api/command-center/deals/[dealId]` when a deal is selected.

---

## Step 6: AE Execution Section

**Create:** `src/components/command-center/ae-execution-section.tsx`

Per-AE cards showing execution quality.

**Per-AE card displays:**
- AE name
- Q2 target vs closed-won ARR (with progress bar)
- Pipeline ARR
- Deal count
- Average grade (large, colored)
- Grade distribution: mini bar chart or pill row showing count per grade (e.g., "2A 5B 3C 1D")
- Deals needing attention count (D+F) — if > 0, shown in warning color

**Card click behavior:** Filter the deal intelligence table to show only that AE's deals.

**Data source:** Fetches from `/api/command-center/ae-execution` on mount (or fetched by parent and passed as props).

---

## Step 7: Integrate into Command Center View

**Modify:** `src/components/command-center/command-center-view.tsx`

Add the new sections below the existing Phase 1 sections:

```
<HeroSummary />
<PacingSection />
<InitiativeTracker />
<WeeklyOperatingTable />
{/* Phase 2 additions below */}
<AEExecutionSection />
<DealIntelligenceTable onSelectDeal={setSelectedDeal} />
{selectedDeal && <DealDetailPanel dealId={selectedDeal} onClose={() => setSelectedDeal(null)} />}
```

**State to add:**
- `selectedDeal: string | null` — hubspot_deal_id of the selected deal (null = panel closed)
- `aeFilter: string | null` — when an AE card is clicked, filter the deal table

**Data fetching:**
- The deals and AE execution data can be fetched in parallel with the existing command center data
- Or fetched lazily when the user scrolls down to those sections (depends on UX preference — eager loading is simpler)

---

## Visual Design Notes

### Deal Intelligence Table
- Dense but readable — this is the operational workhorse of the dashboard
- Alternating row backgrounds for scannability
- Sticky header row
- Grade pills should be small and distinct (not overwhelming)

### Deal Detail Panel
- Width: ~40-50% of screen (slide-over from right)
- Clean sections with clear dividers
- Score bars should be simple (thin horizontal bars, not complex charts)
- Timeline should be vertical with connecting lines between stages

### AE Cards
- Grid layout (2-3 cards per row depending on screen width)
- Progress bar for quota attainment should be the most prominent element
- Grade distribution should be compact (not a full chart — just colored pills or a tiny bar)

---

## Verification Checklist

After executing this phase:

1. **Deals API works:**
   ```bash
   curl http://localhost:3000/api/command-center/deals | jq '.counts'
   # Should return total, byGrade, byLikelihood, withOverrides
   ```

2. **Deal detail API works:**
   ```bash
   # Get a deal ID from the list endpoint first
   DEAL_ID=$(curl -s http://localhost:3000/api/command-center/deals | jq -r '.deals[0].hubspotDealId')
   curl http://localhost:3000/api/command-center/deals/$DEAL_ID | jq '.timeline'
   # Should return stage timeline entries
   ```

3. **AE execution API works:**
   ```bash
   curl http://localhost:3000/api/command-center/ae-execution | jq '.aeExecutions | length'
   # Should return number of AEs
   ```

4. **UI renders:** Navigate to `/dashboard/q2-command-center`:
   - Deal intelligence table shows deals with grades and likelihood
   - Clicking a deal opens the detail panel
   - AE execution cards show per-AE metrics
   - Clicking an AE card filters the deal table

5. **Existing pages untouched:** `/dashboard/q2-goal-tracker` and the deal health queue pages work exactly as before

6. **Build succeeds:** `npm run build`

---

## What Phase 3 Depends On From This Phase

- `GET /api/command-center/deals` returning `DealForecastItem[]` with `likelihoodTier`
- `deal-detail-panel.tsx` with the override section placeholder (Phase 3 adds the edit form)
- `command-center-view.tsx` structure with all sections integrated
- The `DealForecastItem` type with `likelihoodTier` and `override` fields populated
