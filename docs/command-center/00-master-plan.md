# Q2 Revenue Operating Dashboard — Master Plan

## What This Is

A live, intelligent Q2 revenue operating dashboard ("Command Center") inside HubAgent that replaces the static Q2 Goal Tracker with a comprehensive operating layer. It combines historical baselines, real-time Supabase data, deal intelligence scores, initiative tracking, and AI-assisted forecasting.

**Route:** `/dashboard/q2-command-center`

**IMPORTANT: This is additive, not a replacement.** The existing Q2 Goal Tracker (`/dashboard/q2-goal-tracker`) remains completely untouched. The Command Center is a new, separate page that imports from the existing tracker's data layer but does not modify any existing files (except adding a sidebar link and auth resource).

## Why We're Building This

The current Q2 Goal Tracker answers "what would need to happen if historical patterns hold." The Command Center answers "what is actually happening now" — and whether it's enough to hit the Q2 ARR target. Both serve different purposes and coexist.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  /dashboard/q2-command-center (page.tsx)          │
│                                                   │
│  ┌─ Hero Summary ──────────────────────────────┐ │
│  │ Q2 Target | Projected | Gap | On/Off Track  │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Pacing Section ────────────────────────────┐ │
│  │ Lead creation by source vs required          │ │
│  │ Deal creation vs required by week            │ │
│  │ Funnel throughput (MQL→SQL→Demo→Won)         │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Initiative Tracker ────────────────────────┐ │
│  │ CEO Channel Partners | Co-Destiny | etc.     │ │
│  │ Expected vs actual, pacing status            │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Weekly Operating Table ────────────────────┐ │
│  │ 13 weeks × leads/deals/demos/closed-won      │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Deal Intelligence ─────────────────────────┐ │
│  │ Sortable/filterable deal table               │ │
│  │ Grade, likelihood, sentiment, risk           │ │
│  │ Click → Deal Detail Panel (slide-over)       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ AE Execution ─────────────────────────────┐ │
│  │ Per-AE cards: quota, grades, activity        │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Forecast ──────────────────────────────────┐ │
│  │ Rolling forecast by likelihood tier          │ │
│  │ Human overrides + audit trail                │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Executive Summary ─────────────────────────┐ │
│  │ Key insights: what's working, what's not     │ │
│  │ Where leadership should focus today          │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Git Workflow

**Branch:** All work for this feature MUST happen on a dedicated feature branch: `feature/q2-command-center`

```bash
git checkout -b feature/q2-command-center
```

- **DO NOT merge to `main`** until explicitly approved by the user
- **DO NOT push to `main`** under any circumstances
- All commits go to `feature/q2-command-center`
- When all phases are complete, the user will review and approve the merge

This applies to every phase. The Foundation agent creates the branch. All subsequent phase agents checkout and continue on it.

## Phase Execution Rules

Each phase is executed by an independent AI agent. The agent MUST:

1. **Read the phase doc fully** before writing any code
2. **Read `00-master-plan.md`** for architecture context and the code inventory
3. **Work on the `feature/q2-command-center` branch** (create it if Foundation, checkout if subsequent phase)
4. **Run all verification steps** listed at the end of the phase doc before declaring done
5. **Commit all work** with a descriptive commit message referencing the phase
6. **STOP after completing the phase** — do not continue to the next phase
7. **Report results** — tell the user what was built, what the verification showed, and any issues

The agent should NOT proceed to the next phase. Each phase is a clean handoff. The user will deploy a new agent for the next phase.

## Phase Sequence

| Phase | Doc | What Ships | Depends On |
|-------|-----|-----------|------------|
| Foundation | `01-foundation.md` | DB schema, types, config, pacing + initiative compute functions | Nothing |
| Phase 1 | `02-phase-1-pacing.md` | Live pacing dashboard, funnel health, initiative tracker, weekly operating view | Foundation |
| Phase 2 | `03-phase-2-deal-intel.md` | Deal intelligence table, deal detail panel, AE execution review | Phase 1 |
| Phase 3 | `04-phase-3-forecast.md` | Rolling forecast, human overrides, executive summary | Phase 2 |

Each phase is self-contained. An AI agent reads the phase doc, executes it, runs the verification steps. The next agent picks up from there.

## Key Design Decisions

1. **One cron fix, no new crons.** The existing `compute-deal-intelligence` cron is upgraded in Foundation: add `workflow_runs` logging, hardcode DeepSeek v3.2, schedule at 2:30 AM (after sync-hubspot at 2:00 AM so data is fresh). The command center UI reads from pre-computed data at request time.

2. **Deterministic first, AI second.** Pacing, initiative tracking, and forecast math are all pure computation. LLM (DeepSeek v3.2, hardcoded) is only used for deal intelligence scoring (nightly cron) and the optional executive summary narrative (Phase 3).

3. **Reuse, don't fork.** The existing `computeQ2GoalTrackerData()` function is called (read-only) — not duplicated or modified. Same for deal intelligence queries. The existing Q2 Goal Tracker page and API route are never touched.

4. **Override stored separately.** The `deal_forecast_overrides` table keeps human judgments separate from AI output, preserving auditability. The forecast engine merges them at read time.

5. **Lead source on deals.** No separate contact/lead sync needed. Lead sources are tracked via the `lead_source` column on the deals table.

6. **Initiatives = lead_source values.** Strategic initiatives are mapped to specific `lead_source` strings in a config + DB table.

## Existing Code Inventory

These files contain reusable logic that the Command Center builds on. **Do not duplicate — import and call directly.**

### Data Computation
| File | What It Does | Key Exports |
|------|-------------|-------------|
| `src/lib/q2-goal-tracker/compute.ts` | Full Q2 goal computation: cohort rates, lead source rates, per-AE data, weekly actuals, pipeline credit | `computeQ2GoalTrackerData()` |
| `src/lib/q2-goal-tracker/math.ts` | Pure reverse-engineering math, weighted pipeline, gap analysis, weekly targets | `computeWeightedPipeline()`, `computeGap()`, `computeWeeklyTargets()`, `computeDealsNeeded()`, `computeDemosNeeded()`, `computeLeadsNeeded()` |
| `src/lib/q2-goal-tracker/types.ts` | All typed interfaces | `HistoricalRates`, `RateSet`, `LeadSourceRate`, `AEData`, `WeeklyActual`, `PipelineCredit`, `Q2GoalTrackerApiResponse` |
| `src/lib/utils/quarter.ts` | Quarter date boundaries (EST-aware), progress tracking | `getQuarterInfo()`, `getQuarterProgress()`, `getCurrentQuarter()` |

### Deal Intelligence
| File | What It Does | Key Exports |
|------|-------------|-------------|
| `src/lib/intelligence/deal-rules.ts` | Rules-based scoring: hygiene(15%), momentum(30%), engagement(35%), risk(20%). Grades A-F. | `computeAllDealIntelligence()`, `DealIntelligenceRow` |
| `src/lib/intelligence/deal-llm.ts` | LLM enrichment: maps deal coach output to dimension scores | Updates `deal_intelligence` table |
| `src/app/api/queues/deal-intelligence/route.ts` | API serving deal intelligence with pre-demo coaching joins | `DealIntelligenceItem`, `DealIntelligenceResponse` |

### Infrastructure
| File | What It Does | Key Exports |
|------|-------------|-------------|
| `src/lib/auth/types.ts` | Permission system: resources, roles, path mapping | `RESOURCES`, `hasPermission()`, `getResourceFromPath()` |
| `src/lib/auth/api.ts` | API route auth check | `checkApiAuth()` |
| `src/lib/supabase/client.ts` | Supabase client factories | `createClient()`, `createServerSupabaseClient()`, `createServiceClient()` |
| `src/lib/hubspot/stage-config.ts` | All pipeline stage IDs and arrays | `SALES_PIPELINE_STAGES`, `ALL_OPEN_STAGE_IDS`, `PRE_DEMO_STAGE_IDS` |

### UI Patterns
| File | Pattern To Follow |
|------|-------------------|
| `src/components/dashboard/q2-goal-tracker-view.tsx` | Client component with Recharts, slider-driven what-if modeling, rate set switching |
| `src/components/dashboard/sidebar.tsx` | Navigation link pattern, permission-gated sections |
| `src/app/dashboard/q2-goal-tracker/page.tsx` | Auth-gated page wrapper pattern |

## New DB Tables (Created in Foundation)

### `strategic_initiatives`
Named initiatives with lead_source mapping and Q2 targets.

### `deal_forecast_overrides`
Human overrides of AI deal likelihood judgments, with audit trail.

## File Structure (What Gets Created)

```
src/
├── lib/command-center/
│   ├── types.ts                    # Foundation
│   ├── config.ts                   # Foundation
│   ├── compute-pacing.ts           # Foundation
│   ├── compute-initiatives.ts      # Foundation
│   └── compute-forecast.ts         # Phase 3
├── app/
│   ├── api/command-center/
│   │   ├── route.ts                # Phase 1
│   │   ├── weekly-operating/
│   │   │   └── route.ts            # Phase 1
│   │   ├── deals/
│   │   │   ├── route.ts            # Phase 2
│   │   │   └── [dealId]/
│   │   │       ├── route.ts        # Phase 2
│   │   │       └── override/
│   │   │           └── route.ts    # Phase 3
│   │   ├── ae-execution/
│   │   │   └── route.ts            # Phase 2
│   │   ├── forecast/
│   │   │   └── route.ts            # Phase 3
│   │   └── executive-summary/
│   │       └── route.ts            # Phase 3
│   └── dashboard/q2-command-center/
│       └── page.tsx                # Phase 1
├── components/command-center/
│   ├── command-center-view.tsx     # Phase 1 (extended in Phase 2, 3)
│   ├── hero-summary.tsx            # Phase 1 (enhanced in Phase 3)
│   ├── pacing-section.tsx          # Phase 1
│   ├── initiative-tracker.tsx      # Phase 1
│   ├── weekly-operating-table.tsx  # Phase 1
│   ├── deal-intelligence-table.tsx # Phase 2
│   ├── deal-detail-panel.tsx       # Phase 2 (enhanced in Phase 3)
│   ├── ae-execution-section.tsx    # Phase 2
│   ├── forecast-section.tsx        # Phase 3
│   └── executive-summary.tsx       # Phase 3
├── scripts/
│   ├── verify-command-center-foundation.ts  # Foundation
│   └── verify-command-center-forecast.ts    # Phase 3
supabase/
└── migrations/
    └── 072_command_center.sql      # Foundation
```

## Guiding Principle

No bloat. Every file, component, and endpoint directly serves one of the 12 capabilities in the product brief (`q2_dynamic_dash.md`). If something doesn't map to a capability, don't build it.
