# Phase 1: Live Pacing Dashboard + Funnel Health + Initiative Tracking

## Git & Execution Rules

1. **Work on branch `feature/q2-command-center`** — run `git checkout feature/q2-command-center` (it already exists from Foundation)
2. **DO NOT merge to `main`** — the user will approve the merge when all phases are complete
3. **Run all verification steps** at the end of this doc before declaring done
4. **Commit all work** with a message like: `feat: Q2 Command Center — Phase 1 (pacing dashboard, initiatives, weekly view)`
5. **STOP after this phase** — do not continue to Phase 2. Report what was built and verification results to the user.

## Context

**What was built in Foundation (01-foundation.md):**
- DB tables: `strategic_initiatives` (with seed data), `deal_forecast_overrides`
- Types: `src/lib/command-center/types.ts` — `CommandCenterResponse`, `PacingData`, `WeeklyPacingRow`, `SourcePacing`, `InitiativeStatus`
- Config: `src/lib/command-center/config.ts` — `Q2_TEAM_TARGET`, `LIKELIHOOD_WEIGHTS`, `computeLikelihoodTier()`
- Compute: `src/lib/command-center/compute-pacing.ts` — `computePacingData()`
- Compute: `src/lib/command-center/compute-initiatives.ts` — `computeInitiativeStatus()`
- Auth: `RESOURCES.Q2_COMMAND_CENTER` registered in `src/lib/auth/types.ts`
- Verification: `src/scripts/verify-command-center-foundation.ts` passes

**What this phase adds:**
- The main Command Center API endpoint
- The page route and main view component
- Hero summary (target vs actual, on/off track)
- Pacing section (leads/deals by source and week vs required)
- Initiative tracker (per-initiative progress cards)
- Weekly operating table (13 weeks × key metrics)
- Sidebar navigation link

**IMPORTANT: This is additive.** Do not modify the existing Q2 Goal Tracker files. The Command Center is a new, separate page.

**Maps to product brief sections:** 1 (Historical Baseline), 2 (Lead Pacing), 3 (Deal Throughput), 4 (Weekly Visibility), 5 (Initiative Tracking)

---

## Step 1: Main API Endpoint

**Create:** `src/app/api/command-center/route.ts`

This endpoint aggregates all the data the Phase 1 UI needs in a single call.

**Pattern to follow:** See `src/app/api/q2-goal-tracker/route.ts` for the auth + computation + response pattern.

```typescript
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import type { CommandCenterResponse } from '@/lib/command-center/types';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Run existing goal tracker computation + new pacing/initiative computations
    const [goalTracker, initiatives] = await Promise.all([
      computeQ2GoalTrackerData(supabase),
      computeInitiativeStatus(supabase),
    ]);

    // Pacing depends on goal tracker data (needs rates for "required" calculations)
    const pacing = await computePacingData(supabase, goalTracker);

    const response: CommandCenterResponse = {
      goalTracker,
      pacing,
      initiatives,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Command Center error:', error);
    return NextResponse.json(
      { error: 'Failed to compute command center data' },
      { status: 500 }
    );
  }
}
```

**Auth note:** `checkApiAuth` is imported from `src/lib/auth/api.ts`. `RESOURCES` is imported from `src/lib/auth` (which re-exports from `src/lib/auth/types.ts`). Check the exact import path used by other API routes in the codebase.

---

## Step 2: Page Route

**Create:** `src/app/dashboard/q2-command-center/page.tsx`

**Pattern to follow:** See `src/app/dashboard/q2-goal-tracker/page.tsx` for the auth-gated wrapper pattern.

This is a server component that:
1. Checks permissions using `requirePermission(RESOURCES.Q2_COMMAND_CENTER)`
2. Renders the client component `<CommandCenterView />`

```typescript
import { requirePermission } from '@/lib/auth/server';
import { RESOURCES } from '@/lib/auth';
import CommandCenterView from '@/components/command-center/command-center-view';

export default async function Q2CommandCenterPage() {
  await requirePermission(RESOURCES.Q2_COMMAND_CENTER);
  return <CommandCenterView />;
}
```

**Note:** Check how `requirePermission` is imported in the existing Q2 goal tracker page and match that pattern exactly. It may be `@/lib/auth/server` or a different path.

---

## Step 3: Main View Component

**Create:** `src/components/command-center/command-center-view.tsx`

This is the orchestrating client component. It:
1. Fetches data from `/api/command-center`
2. Renders all sections with loading/error states
3. Will be extended in Phase 2 and 3 with additional sections

**Pattern to follow:** See `src/components/dashboard/q2-goal-tracker-view.tsx` for the client component pattern (data fetching, loading states, section layout).

**Key implementation notes:**
- Use `'use client'` directive
- Fetch with `useEffect` + `useState` pattern (or `useSWR` if the project uses it — check existing components)
- Show a loading skeleton while data loads
- Pass sub-data to each section component as props

```
Layout structure:
  <div className="space-y-8 p-6">
    <HeroSummary data={...} />
    <PacingSection data={...} />
    <InitiativeTracker data={...} />
    <WeeklyOperatingTable data={...} />
    {/* Phase 2 will add: DealIntelligenceTable, AEExecutionSection */}
    {/* Phase 3 will add: ForecastSection, ExecutiveSummary */}
  </div>
```

---

## Step 4: Hero Summary Component

**Create:** `src/components/command-center/hero-summary.tsx`

The top-of-page summary that immediately answers the most important questions.

**Displays:**
- Q2 ARR Target (from `goalTracker.teamTarget`)
- Closed Won So Far (from `goalTracker.weeklyActuals` — sum of closedWonARR)
- Weighted Pipeline (computed using `computeWeightedPipeline()` from `src/lib/q2-goal-tracker/math.ts`)
- Gap to Target (from `computeGap()`)
- Week N of 13 (from `goalTracker.progress`)
- Quarter % Complete (from `goalTracker.progress.percentComplete`)
- On Track / Behind / At Risk indicator

**On Track logic:**
- Calculate required pace: `teamTarget × (currentWeek / 13)`
- Compare actual (closedWon + weightedPipeline) to required pace
- `>= 90%` = On Track (green), `>= 70%` = Behind (yellow), `< 70%` = At Risk (red)

**UI notes:**
- Use a clean card-based layout with large numbers
- Currency formatting: use the `fmt` / `fmtFull` pattern from the existing `q2-goal-tracker-view.tsx` (check for a currency formatter utility)
- Status indicator should use color purposefully: green calm, yellow noticeable, red clear

**Props:** Accepts the `goalTracker: Q2GoalTrackerApiResponse` from the parent.

---

## Step 5: Pacing Section

**Create:** `src/components/command-center/pacing-section.tsx`

Shows whether lead/deal creation is keeping pace with what's required.

**Two sub-sections:**

### 5a. Weekly Deal Creation Pacing
- Recharts `AreaChart` showing cumulative deals created vs cumulative required (linear pace)
- X-axis: Week 1-13, Y-axis: cumulative count
- Two lines: "Required Pace" (straight line to `totalLeadsRequired`) and "Actual" (cumulative sum of `weeklyRows[].leadsCreated`)
- Current week highlighted
- **Pattern:** Reuse the Recharts setup from `q2-goal-tracker-view.tsx` (it already has a cumulative pacing chart)

### 5b. Source Breakdown Table
- Table with columns: Source, Created, Required, Pace Status
- Pace status shown as colored badge: ahead (green), on_pace (neutral), behind (red)
- Sorted by total created descending

**Props:** Accepts `pacing: PacingData` from the parent.

**Recharts import pattern:** Check how Recharts is imported in the existing Q2 goal tracker view and match exactly. The project uses `recharts` (not a wrapper).

---

## Step 6: Initiative Tracker

**Create:** `src/components/command-center/initiative-tracker.tsx`

A card for each strategic initiative showing progress vs expectations.

**Per-initiative card displays:**
- Initiative name + owner label (e.g., "CEO Channel Partners — CEO")
- Leads created vs target (with progress bar)
- ARR generated vs target
- Pacing status badge (ahead/on_pace/behind)
- Weekly sparkline showing creation trend (13 data points from `weeklyBreakdown`)

**Empty state:** If no initiatives exist or all show 0 leads, show a muted message: "No initiative activity recorded yet. Verify lead source values match HubSpot."

**Props:** Accepts `initiatives: InitiativeStatus[]` from the parent.

---

## Step 7: Weekly Operating Table

**Create:** `src/components/command-center/weekly-operating-table.tsx`

A 13-row spreadsheet-style table showing the quarter week by week.

**Columns:**
| Week | Dates | Deals Created | Demos Completed | Closed Won | Closed Won ARR |
|------|-------|---------------|-----------------|------------|----------------|

**Row behavior:**
- Current week highlighted (use `goalTracker.progress.currentWeek`)
- Future weeks grayed out
- Past weeks with 0 activity shown in a warning color

**Props:** Accepts `weeklyRows: WeeklyPacingRow[]` and `currentWeek: number`.

**Pattern:** The existing Hot Tracker and Demo Tracker use similar spreadsheet-style weekly tables. Check `src/components/dashboard/hot-tracker-view.tsx` for the table styling pattern.

---

## Step 8: Sidebar Navigation Link

**Modify:** `src/components/dashboard/sidebar.tsx`

Add a "Q2 Command Center" link near the existing Q2 Goal Tracker link.

**Pattern to follow (from existing sidebar):**

1. Add state variable (around line 201):
```typescript
const isOnCommandCenter = pathname === '/dashboard/q2-command-center';
```

2. Add the link block near the Q2 Goal Tracker link (around line 348-365), gated by permission:
```typescript
{hasPermission(user, RESOURCES.Q2_COMMAND_CENTER) && (
  <div className="mb-2">
    <Link
      href="/dashboard/q2-command-center"
      className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
        isOnCommandCenter
          ? 'text-white bg-zinc-800'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {/* Use an appropriate icon - check what icons the sidebar already uses */}
      <span className={isCollapsed ? '' : ''}>
        {isCollapsed ? 'CC' : 'Q2 Command Center'}
      </span>
    </Link>
  </div>
)}
```

**Important:** Read the full sidebar file before editing to understand the exact structure, icon pattern, and permission check style. The snippet above is a guide — match the existing code style exactly.

---

## Visual Design Notes

The product brief specifies the UI should feel like "mission control for revenue operations" — premium, controlled, high-signal, not cluttered.

- **Color palette:** Match the existing dashboard's dark theme (zinc/slate backgrounds, white text)
- **Spacing:** Use consistent `space-y-8` between sections, `p-6` padding
- **Cards:** Rounded corners, subtle borders, clear hierarchy
- **Status colors:** Green = calm/confident, Yellow = noticeable, Red = clear action needed
- **Typography:** Large numbers for hero metrics, medium for section headers, small for table data
- **No decoration for decoration's sake:** Every visual element communicates meaning

---

## Verification Checklist

After executing this phase:

1. **API works:**
   ```bash
   # Start dev server: npm run dev
   # Then in another terminal:
   curl http://localhost:3000/api/command-center | jq '.goalTracker.teamTarget'
   # Should return: 925000
   curl http://localhost:3000/api/command-center | jq '.pacing.totalLeadsCreated'
   # Should return a number
   curl http://localhost:3000/api/command-center | jq '.initiatives | length'
   # Should return number of active initiatives
   ```

2. **Page renders:** Navigate to `http://localhost:3000/dashboard/q2-command-center` — should show the Command Center with all sections

3. **Sidebar link:** The "Q2 Command Center" link appears in the sidebar and navigates correctly

4. **Existing tracker untouched:** Navigate to `/dashboard/q2-goal-tracker` — should work exactly as before

5. **Build succeeds:** `npm run build` — no TypeScript errors

---

## What Phase 2 Depends On From This Phase

- Working `/api/command-center` endpoint returning `CommandCenterResponse`
- `command-center-view.tsx` component structure (Phase 2 adds sections into it)
- `hero-summary.tsx` component (Phase 3 will enhance it with forecast data)
- Working sidebar navigation to `/dashboard/q2-command-center`
- The page route at `src/app/dashboard/q2-command-center/page.tsx`
