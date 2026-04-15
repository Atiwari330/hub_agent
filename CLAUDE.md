# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RevOps AI Agent - A personal AI-powered revenue operations assistant built on HubSpot CRM data. The system provides an LLM agent with tools to query, analyze, and summarize deal data for a VP of Revenue Operations, plus a dashboard for tracking Account Executive (AE) performance metrics.

## Commands

```bash
# Development
npm run dev              # Start dev server with Turbopack
npm run build            # Production build
npm run lint             # ESLint

# Test scripts (run with tsx)
npm run test:hubspot     # Test HubSpot connection
npm run test:owners      # Test owners API
npm run test:deals       # Test deals API
npm run test:agent       # Interactive agent REPL
npm run ask              # Alias for test:agent

# Analysis CLIs
npm run deals-analysis                 # Comprehensive deals/lead source/funnel analysis (current year)
npm run deals-analysis -- --year=2025  # Specific year

# Utility tests
npx tsx src/scripts/test-utils.ts  # Test quarter/currency utilities
```

## Deals Analysis

Reusable analysis engine at `src/lib/analysis/deals-analysis.ts` that powers three surfaces:

1. **CLI** — `npm run deals-analysis` outputs a markdown report (revenue, lead sources, AE performance, funnel, data quality)
2. **Agent tool** — The `dealsAnalysis` tool is registered in the AI agent. Ask natural language questions about lead quality, win rates, source effectiveness, or pipeline health.
3. **Dashboard** — `/dashboard/deals-analysis` shows KPI cards, lead source table, funnel chart, AE comparison, and data quality alerts

The analysis auto-deduplicates deals (same name + amount + close date = dupe) and scopes by year. It uses two cohorts: deals *created* in the year (for conversion metrics) and deals *closed won* in the year regardless of create date (for revenue).

Core function: `runDealsAnalysis({ year? })` returns a typed `DealsAnalysisResult`.

## Dev Server (Preview)

Dev server config is stored in `.claude/launch.json`. Use `preview_start` to launch servers by name.

Current configurations:
- **next-dev** — Next.js dev server (`npm run dev`, port 3000, autoPort enabled)

To start the dev server in a conversation, use the Claude Preview `preview_start` tool with `name: "next-dev"`. This is useful at the start of a session when Adi wants to preview dashboard changes.

## Architecture

### Tech Stack
- **Next.js 15** (App Router, Turbopack)
- **Vercel AI SDK** with Anthropic via AI Gateway
- **Supabase** (PostgreSQL) for persistence
- **HubSpot API** (@hubspot/api-client) for CRM data
- **TailwindCSS 4** for styling
- **Zod** for runtime validation

### Directory Structure

```
src/
├── app/
│   ├── api/
│   │   ├── ae/[ownerId]/     # AE metrics, deals, quota endpoints
│   │   ├── agent/            # Streaming agent chat endpoint
│   │   └── cron/             # Scheduled jobs (sync-hubspot, sentiment-analysis)
│   └── dashboard/            # AE dashboard UI (layout + ae/[ownerId] detail pages)
├── components/dashboard/     # Sidebar, metrics cards, deals table, etc.
├── lib/
│   ├── ai/
│   │   ├── agent.ts          # RevOps agent configuration and runners
│   │   └── tools/            # Agent tools (list-owners, get-deals, analyze-sentiment, etc.)
│   ├── hubspot/              # HubSpot API wrappers (owners, deals, pipelines, engagements)
│   ├── supabase/             # Supabase client factories (browser, server, service role)
│   └── utils/                # Quarter calculations, currency formatting
├── scripts/                  # Test/debug scripts
└── types/                    # TypeScript types and Zod schemas
```

### Key Patterns

**Supabase Clients** (`src/lib/supabase/client.ts`):
- `createClient()` - Browser client for client components
- `createServerSupabaseClient()` - Server client with cookie handling
- `createServiceClient()` - Service role client for cron jobs (bypasses RLS)

**Agent Architecture** (`src/lib/ai/agent.ts`):
- Uses `generateText`/`streamText` from Vercel AI SDK
- Tools defined with Zod schemas in `src/lib/ai/tools/`
- System prompt tailored for RevOps analysis
- Max 10 steps per agent run

**API Route Pattern**:
- Cron routes verify `CRON_SECRET` (bypassed in dev mode)
- AE routes use dynamic `[ownerId]` segments
- All database operations via Supabase client

### Database Schema

Tables in Supabase (see `supabase/migrations/`):
- `owners` - Cached HubSpot owners
- `deals` - Cached HubSpot deals
- `deal_notes` - Cached notes per deal
- `sentiment_analyses` - LLM-generated sentiment results
- `quotas` - AE quarterly targets
- `workflow_runs` - Cron job execution logs
- `agent_conversations` - Agent interaction logs

### Scheduled Jobs (vercel.json)

- `/api/cron/sync-hubspot` - Daily 2am: Sync owners and deals from HubSpot
- `/api/cron/sentiment-analysis` - Daily 3am: Run sentiment analysis on deals

## Model Selection (DeepSeek default — no Anthropic)

Every LLM call in this codebase routes through Vercel AI Gateway and uses **DeepSeek v3.2** by default. The policy is zero Anthropic token spend unless a specific feature opts in explicitly.

- `getDeepSeekModel()` in `src/lib/ai/provider.ts` is the only named model factory — every production call site lands on DeepSeek.
- `getModel()` in the same file is a debug hatch: it reads `AI_PROVIDER` / `AI_MODEL` env vars and falls through to Anthropic if `AI_PROVIDER=anthropic` is set. No production code sets these env vars; they exist for ad-hoc debugging only.
- `getModelForPass()` in `src/lib/ai/passes/models.ts` routes every pass through `getDeepSeekModel()` unless `PASS_MODEL_<NAME>` is set to any non-`deepseek` value, in which case it falls through to the `getModel()` debug hatch.

**To reintroduce Claude for one specific feature:** add a new named factory (e.g. `getSonnetModel()`) in `provider.ts` and import it directly at the call site. Do not reintroduce Claude by adding env-var branches to `getModelForPass()` or flipping defaults — the named factory pattern keeps every Claude call site grep-able (`grep -rn "getSonnetModel\|getOpusModel" src/`) for future token-spend audits.

## Environment Variables

Required in `.env.local`:
```
HUBSPOT_ACCESS_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_GATEWAY_API_KEY=
CRON_SECRET=           # Optional in dev, required in production
NEXT_PUBLIC_APP_URL=   # Optional, for API calls in SSR
```

## HubSpot Integration Notes

- Deal stage IDs are UUIDs, not human-readable names
- Use `getPipelines()` tool or `src/lib/hubspot/pipelines.ts` to map stage IDs to names
- Closed-won stages identified by checking stage metadata `isClosed` + `closedWonProbability === 1`
- The sync job upserts on `hubspot_deal_id` and `hubspot_owner_id`

## Dashboard Filtering

The dashboard sidebar is filtered to show only specific AEs. Target emails are defined in `src/app/dashboard/layout.tsx`:
```typescript
const TARGET_AE_EMAILS = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com',
];
```

## Data Sync Architecture

**Important:** The dashboard displays CACHED data from Supabase, NOT real-time HubSpot data.

Data flow:
```
HubSpot CRM → [Sync job at 2 AM daily] → Supabase DB → Dashboard UI
```

- Sync job: `/api/cron/sync-hubspot` pulls all owners and deals from HubSpot
- Dashboard queries Supabase for fast performance
- Data staleness: Up to 24 hours (configurable in `vercel.json`)
- Manual sync: Call `GET /api/cron/sync-hubspot` to trigger immediate sync

## Deal Properties (Dashboard Columns)

The deals table displays these properties (in order):
1. Deal Name
2. Amount
3. Close Date
4. Stage
5. Create Date (`hubspot_created_at`)
6. Lead Source (`lead_source`)
7. Last Activity (`last_activity_date`)
8. Next Activity (`next_activity_date`)
9. Next Step (`next_step`)
10. Products (`products`)
11. Substage (`deal_substage`)

HubSpot property mappings (see `src/lib/hubspot/deals.ts`):
- `createdate` → `hubspot_created_at`
- `lead_source__sync_` → `lead_source`
- `notes_last_updated` → `last_activity_date`
- `notes_next_activity_date` → `next_activity_date`
- `hs_next_step` → `next_step`
- `product_s` → `products`
- `proposal_stage` → `deal_substage`

## Pending Database Migration

**IMPORTANT FOR FUTURE AGENTS:** If the dashboard shows errors for new deal properties, run migration:
```sql
-- File: supabase/migrations/002_add_deal_properties.sql
-- Adds columns: hubspot_created_at, lead_source, last_activity_date,
--               next_activity_date, next_step, products, deal_substage
```

## Recent Development History

| Commit | Description |
|--------|-------------|
| `a289e18` | Added 7 new deal properties to dashboard (Create Date, Lead Source, Last Activity, Next Activity, Next Step, Products, Substage) |
| `d1c9223` | Added diagnostic scripts for HubSpot property investigation |
| `7679523` | Added deal status filter with active pipeline default |
| `56ac523` | Added CLAUDE.md for Claude Code guidance |
| `6947d4a` | Initial AE detail view dashboard with HubSpot integration |

## Weekly Pipeline Tracking (Leading Indicators)

The dashboard now tracks when deals entered key pipeline stages to identify leading indicators for meeting quarterly goals.

### Tracked Stages (Sales Pipeline)
| Stage | HubSpot Stage ID | DB Column |
|-------|------------------|-----------|
| MQL | `2030251` | `mql_entered_at` |
| SQL (legacy) | `17915773` | `sql_entered_at` |
| SQL/Discovery | `138092708` | `discovery_entered_at` |
| Demo Scheduled | `baedc188-ba76-4a41-8723-5bb99fe7c5bf` | `demo_scheduled_entered_at` |
| Demo Completed | `963167283` | `demo_completed_entered_at` |
| Closed Won | `97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5` | `closed_won_entered_at` |

### Stage Mappings File
`src/lib/hubspot/stage-mappings.ts` contains the stage ID to property mappings.

### API Endpoint
`GET /api/ae/[ownerId]/weekly-pipeline` - Returns weekly deal counts per stage for the quarter.

Query params:
- `year` - Fiscal year (default: current year)
- `quarter` - Fiscal quarter 1-4 (default: current quarter)

### Dashboard Components
- `WeeklyPipelineChart` - Bar chart showing deals entering each stage by week
- `TargetProgress` - Banner showing target vs actual with on/off track indicator

### Database Migration
```sql
-- File: supabase/migrations/003_stage_timestamps.sql
-- Adds columns: sql_entered_at, demo_scheduled_entered_at,
--               demo_completed_entered_at, closed_won_entered_at
-- Creates table: ae_targets (with $100k default per AE)
```

## Support Ticket Analysis System

Support tickets sync from HubSpot hourly (`/api/cron/sync-tickets`) into `support_tickets` table. Each ticket gets three independent LLM analyses (`/api/cron/analyze-support`):

| Queue | Table | Prompt File | Purpose |
|-------|-------|-------------|---------|
| Action Board | `ticket_action_board_analyses` | `src/app/api/queues/support-action-board/analyze/analyze-core.ts` | Operational actions for agents |
| Trainer | `ticket_trainer_analyses` | `src/app/api/queues/support-trainer/analyze/analyze-core.ts` | Training material for new hires |
| Manager | `ticket_support_manager_analyses` | `src/app/api/queues/support-manager/analyze/analyze-core.ts` | Triage & escalation for CS Manager |

Each analysis fetches: ticket metadata, HubSpot conversation thread, engagement timeline, Linear context (if linked), customer knowledge (`src/lib/ai/knowledge/customers/`), support knowledge (`src/lib/ai/knowledge/support/`), and related open tickets from the same company.

### Iterating on Ticket Analysis

When the user spots an issue with a ticket's analysis (wrong action owner, bad temperature, irrelevant suggestion, etc.), use this workflow:

1. **Inspect the ticket** to get full context:
```bash
npx tsx src/scripts/inspect-ticket.ts <ticket_id>
npx tsx src/scripts/inspect-ticket.ts --company "Company Name"
npx tsx src/scripts/inspect-ticket.ts --subject "keyword"
npx tsx src/scripts/inspect-ticket.ts <ticket_id> --engagements  # include raw HubSpot data
```

2. **Read the relevant prompt** in the `analyze-core.ts` file for the affected queue
3. **Fix the prompt/logic** based on the issue
4. **User re-analyzes** via the UI's Re-analyze button to verify

The inspect script outputs: ticket metadata, all three analysis results, action item completions, and shift reviews — everything needed to diagnose analysis quality issues.

## Ticket Triage CLI (`npm run triage`)

On-demand CLI tool that analyzes all open support tickets and produces a markdown report with the **single most critical next step** per ticket. Optimized for high signal, low noise.

**How it works:** Fetches open tickets from Supabase, then for each ticket runs a 3-pass DeepSeek v3.2 pipeline:
1. **Timeline Reconstruction** — merges conversations, engagements, and Linear comments into one chronological narrative
2. **Status Determination** — classifies ticket as one of: `AGENT_ACTION_NEEDED`, `WAITING_ON_CUSTOMER`, `WAITING_ON_ENGINEERING`, `ENGINEERING_FOLLOWUP_NEEDED`, `CLARIFICATION_NEEDED_FROM_LINEAR`, `READY_TO_CLOSE`, `STALE`
3. **Next Step Synthesis** — produces one concrete action with specific details and urgency level

**Data freshness:** Ticket metadata comes from Supabase (depends on sync job). Conversation content and engagements are fetched live from HubSpot. Linear context is fetched live. Use `--sync` to force a fresh sync before analysis.

**Usage:**
```bash
npm run triage                          # Triage all open tickets
npm run triage -- --sync                # Sync from HubSpot first (requires dev server)
npm run triage -- --ticket=43445591737  # Single ticket (for debugging)
npm run triage -- --verbose             # Include full timeline per ticket
npm run triage -- --concurrency=3       # Adjust parallelism (default: 5)
npm run triage -- --output=my-report.md # Custom output file
```

**Output:** Grouped markdown report sorted by status then urgency. Written to `triage-report-YYYY-MM-DD.md` and printed to stdout.

**Script:** `src/scripts/ticket-triage.ts` — reuses `gatherTicketContext()` from `src/lib/ai/passes/gather-context.ts` for all data gathering.

## Deal Scrub CLI (`npm run deal-scrub`)

On-demand CLI tool that analyzes an AE's open deals and produces a pipeline hygiene report. Fetches all engagement data (notes, emails, calls, meetings, tasks) live from HubSpot, then runs a 4-pass DeepSeek v3.2 pipeline per deal:
1. **Activity Timeline** — merges all engagements chronologically, flags gaps, notes interaction quality
2. **Health Assessment** — classifies: Activity Level, Customer Engagement, AE Effort, Deal Momentum
3. **Recommendation** — one of: `KEEP_WORKING`, `CHANGE_APPROACH`, `ESCALATE`, `MOVE_TO_NURTURE`, `CLOSE_OUT`
4. **Executive Summary** — 2-3 sentence CRO-scannable summary

**Usage:**
```bash
npm run deal-scrub -- --owner=cgarraffa@opusbehavioral.com                     # All open deals
npm run deal-scrub -- --owner=cgarraffa@opusbehavioral.com --stage=mql,discovery  # Filter by stage(s)
npm run deal-scrub -- --deal=12345678901 --verbose                              # Single deal deep-dive
npm run deal-scrub -- --owner=EMAIL --concurrency=3 --output=my-report.md       # Custom options
```

**Stage slugs:** `mql`, `discovery`, `demo-scheduled`, `demo-completed`, `proposal`, `closed-won` (comma-separated for multiple).

**Output:** Grouped markdown report sorted by recommendation (most urgent first). Written to `deal-scrub-{name}-{date}.md` and printed to stdout.

**Script:** `src/scripts/deal-scrub.ts`

## PPL Cadence CLI (`npm run ppl-cadence`)

Analyzes Paid Per Lead (PPL) deals for compliance with the CMO's **3-2-1 method**: 6 calls in 3 business days, 6-7 multi-channel touches in 5 business days, 1-2 touches/week nurture after week 1. Uses 4-pass DeepSeek v3.2 pipeline per deal:
1. **Activity Timeline** — chronological outreach with channel tags, email open tracking, business-day gap flags
2. **3-2-1 Compliance** — per-component rating (THREE/TWO/ONE) plus speed-to-lead, channel diversity, prospect email engagement signal
3. **Verdict & Coaching** — EXEMPLARY/COMPLIANT/NEEDS_IMPROVEMENT/NON_COMPLIANT + one coaching point + risk flags
4. **Executive Summary** — 1-2 sentence blunt summary

Computes deterministic metrics first (speed to lead, call counts, email open rate, channel diversity), then passes them as "floor values" to the LLM for spirit-of-compliance assessment. Includes email engagement intelligence: prospect open/click behavior determines nurture window (3wk for low interest, 4wk for engaged-passive). Flags engagement risk when prospects open emails but rep stopped outreach.

**Usage:**
```bash
npm run ppl-cadence                                                          # All target AEs
npm run ppl-cadence -- --owner=cgarraffa@opusbehavioral.com                  # Single AE
npm run ppl-cadence -- --owner=cgarraffa@opusbehavioral.com --max-age=14     # Last 2 weeks only
npm run ppl-cadence -- --deal=12345678901 --verbose                          # Single deal deep-dive
npm run ppl-cadence -- --min-age=7 --max-age=30                              # Deals 7-30 days old
```

**Options:** `--owner=EMAIL`, `--deal=ID`, `--concurrency=N` (default 3), `--verbose`, `--min-age=DAYS`, `--max-age=DAYS`, `--output=FILE`

**Output:** Grouped markdown report sorted by verdict (worst first), per-deal cards with metrics + coaching, AE comparison table when multiple AEs. Written to `ppl-cadence-{date}.md`.

**Script:** `src/scripts/ppl-cadence.ts` — uses `batchFetchDealEngagements()` for efficient bulk HubSpot fetching, `touch-counter.ts` for metric computation.

## Diagnostic Scripts

Located in `src/scripts/`:
- `inspect-ticket.ts` - Full ticket inspection (metadata + all analyses + completions + reviews)
- `check-close-dates.ts` - Compare HubSpot vs DB close dates
- `find-hubspot-properties.ts` - List all HubSpot deal properties
- `test-new-properties.ts` - Test fetching new properties
- `test-new-properties-recent.ts` - Test on recent deals
- `verify-hubspot-close-dates.ts` - Verify 2026 close dates
- `list-pipeline-stages.ts` - List all HubSpot pipeline stages with IDs
- `test-stage-timestamps.ts` - Test fetching stage entry timestamps
- `stage-counts.ts` - Regression-aware deal counts by stage (`--year` / `--quarter` flags)
- `validate-ppl-kpi.ts` - Independent hand-verification of the Week 1 PPL compliance KPI
- `validate-rates.ts` - Data integrity check for the Q2 Goal Tracker historical rates
- `verify-command-center-forecast.ts` / `verify-command-center-foundation.ts` - Smoke tests for the command-center forecast engine
- `run-strategic-directives.ts` - Strategic directives engine CLI (`--time-range`, `--focus`, `--phase1-only`)

One-off debug/investigation scripts from past sessions live in `src/scripts/archive/`. They're not part of the app's active surface but remain in-tree for historical reference.
