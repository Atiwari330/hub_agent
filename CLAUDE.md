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

# Utility tests
npx tsx src/scripts/test-utils.ts  # Test quarter/currency utilities
```

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
  'aboyd@opusbehavioral.com',
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com',
];
```
