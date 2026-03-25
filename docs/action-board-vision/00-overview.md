# Action Board Vision: Intelligent Ticket Operations

## Why This Exists

The Support Action Board is the operational nerve center for Opus Behavioral Health's support team. It drives agents to move every ticket forward, every shift. Today, it works — but it operates on a **batch-and-stale** model where analysis is a snapshot that decays the moment something changes on a ticket.

This document series describes a transformation from that batch model into an **event-driven, continuously intelligent system** where:

- Action items are always current, never stale
- The UI updates in real time as tickets evolve
- Multiple specialized LLM passes produce higher-quality analysis than a single monolithic call
- The system proactively detects escalation risk, SLA danger, and cross-ticket patterns
- Every analysis is self-critiqued before being shown to agents

The guiding assumption: **LLM calls are not a cost constraint.** We optimize for analysis quality, freshness, and usefulness — not for minimizing API calls.

---

## Current State (What We're Changing From)

### Architecture Today

```
HubSpot CRM
    ↓ (sync-tickets cron, hourly during business hours)
Supabase `support_tickets` table
    ↓ (analyze-support cron, every 10 min, mode=full)
    ↓ (ONE monolithic LLM call per ticket)
Supabase `ticket_action_board_analyses` table
    ↓ (UI fetches once on page load)
Action Board UI (static until manual refresh)
```

### Key Files in Current System

| File | Purpose |
|------|---------|
| `src/app/api/queues/support-action-board/analyze/analyze-core.ts` | Core analysis — single LLM call producing 12 output fields |
| `src/app/api/queues/support-action-board/route.ts` | GET endpoint — fetches all tickets + analyses + completions + notes |
| `src/app/api/queues/support-action-board/batch-analyze/route.ts` | Batch re-analysis with SSE progress streaming |
| `src/app/api/queues/support-action-board/complete-action/route.ts` | Action item completion tracking |
| `src/app/api/queues/support-action-board/progress-note/route.ts` | Per-agent daily progress notes |
| `src/app/api/cron/analyze-support/route.ts` | Cron runner (every 10 min, full re-analysis) |
| `src/app/api/cron/sync-tickets/route.ts` | Hourly HubSpot ticket sync |
| `src/components/dashboard/queues/support-action-board-view.tsx` | Full UI component (~1019 lines) |
| `src/lib/hubspot/ticket-engagements.ts` | Fetches engagement timeline from HubSpot |
| `src/lib/hubspot/tickets.ts` | HubSpot ticket fetching (open + recently closed) |
| `vercel.json` | Cron schedules |

### Current Limitations

1. **Stale action items**: Generated at analysis time, never updated until full re-analysis
2. **No real-time UI**: Page fetches once on load; manual refresh required
3. **Monolithic analysis**: One LLM call tries to do 12 things at once (summarize, generate actions, assess temperature, verify completions, etc.)
4. **Batch-only triggers**: Analysis runs on cron schedule or manual button click — not in response to ticket events
5. **No action item lifecycle**: Items are born during analysis and sit there until the next analysis overwrites them
6. **Timing metrics decay**: `hours_since_customer_waiting` is calculated at analysis time and never recalculated
7. **No proactive intelligence**: System doesn't predict escalations, detect patterns, or alert on SLA risk
8. **No self-critique**: Analysis quality depends entirely on the single LLM call getting it right

---

## Target Architecture

```
HubSpot CRM ──webhook──→ Event Router ──→ Targeted Analysis Passes
                                              ├─→ Situation Pass
                                              ├─→ Action Item Pass
                                              ├─→ Temperature Pass
                                              ├─→ Verification Pass
                                              ├─→ Response Draft Pass
                                              └─→ Quality Review Pass
                                                      ↓
                                              Supabase (writes)
                                                      ↓
                                              Supabase Realtime
                                                      ↓
                                              UI (live updates)

Background Processes (continuous):
  ├─→ Staleness Monitor (every 15 min)
  ├─→ Escalation Predictor (every 30 min)
  ├─→ Cross-Ticket Pattern Detector (every 2 hours)
  └─→ SLA Risk Monitor (every 5 min)
```

---

## Implementation Phases

Each phase is documented in its own file with specific implementation details, file changes, database migrations, and testing procedures.

| Phase | Document | Summary | Depends On | Status |
|-------|----------|---------|------------|--------|
| 1 | [01-realtime-ui.md](./01-realtime-ui.md) | Supabase Realtime subscriptions + live UI updates | None | **COMPLETE** |
| 2 | [02-multi-pass-analysis.md](./02-multi-pass-analysis.md) | Decompose monolithic LLM call into specialized passes | None | **COMPLETE** |
| 3 | [03-event-driven-webhooks.md](./03-event-driven-webhooks.md) | HubSpot/Linear webhooks → targeted analysis triggers | Phase 2 | **COMPLETE** |
| 4 | [04-living-action-items.md](./04-living-action-items.md) | Action item lifecycle: auto-complete, auto-generate, staleness | Phases 2, 3 | **COMPLETE** |
| 5 | [05-quality-layers.md](./05-quality-layers.md) | Self-critique, confidence calibration, quality gates | Phase 2 | **COMPLETE** |
| 6 | [06-proactive-intelligence.md](./06-proactive-intelligence.md) | Escalation prediction, SLA monitoring, pattern detection | Phases 1, 2, 3 | Not started |
| 7 | [07-contextual-memory.md](./07-contextual-memory.md) | Analysis history, diff-aware updates, ticket evolution narrative | Phase 2 | Not started |

### Phase Ordering Rationale

**Phase 1 (Realtime UI)** and **Phase 2 (Multi-Pass)** have no dependencies and can be built in parallel. Phase 1 is listed first because it provides immediate visible value — the UI updates live — and creates the foundation that makes every subsequent phase feel responsive.

**Phase 2 (Multi-Pass)** is the engine change. It restructures how analysis works so that Phases 3-7 can trigger individual passes instead of re-running the entire analysis.

**Phase 3 (Webhooks)** depends on Phase 2 because event-driven triggers need to dispatch to specific analysis passes, not the old monolithic function.

**Phase 4 (Living Action Items)** depends on both Phase 2 (separate action pass) and Phase 3 (event triggers) to enable auto-completion detection and event-driven regeneration.

**Phase 5 (Quality Layers)** depends on Phase 2 because the review pass critiques the outputs of the specialized passes.

**Phase 6 (Proactive Intelligence)** depends on Phases 1 (realtime alerts), 2 (specialized passes to run), and 3 (event data to analyze patterns).

**Phase 7 (Contextual Memory)** depends on Phase 2 because diff-aware analysis requires the multi-pass structure to compare against previous pass outputs.

---

## Model Selection Notes

The current system uses `getSonnetModel()` (Claude Sonnet via AI Gateway). With the assumption that cost is not a constraint:

- **Specialized passes** (situation, temperature, action items): Can use a fast, cheap model (e.g., DeepSeek, GPT-4o-mini, Claude Haiku) since each pass is focused and simpler
- **Quality review pass**: Should use the strongest available model (Claude Opus/Sonnet) since it's evaluating and critiquing
- **Proactive intelligence**: Can use mid-tier models for background pattern detection
- **Response drafts**: Should use a high-quality model since the output is customer-facing

The multi-pass architecture enables **model mixing** — use the right model for each job rather than one model for everything.

---

## Database Impact Summary

Across all phases, these are the new/modified tables:

| Table | Phase | Purpose |
|-------|-------|---------|
| `analysis_passes` | 2 | Individual pass results (situation, actions, temperature, etc.) |
| `analysis_pass_history` | 7 | Historical pass results for diff-aware analysis |
| `action_item_events` | 4 | Action item lifecycle events (created, completed, superseded, expired) |
| `webhook_events` | 3 | Inbound webhook log for debugging and replay |
| `ticket_alerts` | 6 | Proactive alerts (escalation risk, SLA, patterns) |
| `quality_reviews` | 5 | Quality review pass results and scores |

Existing tables modified:
- `ticket_action_board_analyses` — gains `last_pass_type`, `pass_version` columns (Phase 2)
- `action_item_completions` — gains `auto_detected` boolean (Phase 4)
- `support_tickets` — gains `escalation_risk_score` column (Phase 6)

---

## How to Use These Docs

**For AI agents working on implementation:**
1. Read this overview first for full context
2. Read the specific phase document you're implementing
3. Each phase doc contains: current state, target state, specific file changes, database migrations, testing steps
4. Phases are designed to be independently deployable — each phase produces a working system

**For the project owner (Adi):**
- Each phase can be reviewed and deployed independently
- The phases are ordered by dependency and value — Phase 1 and 2 are the foundation
- You can reorder phases 4-7 based on what's most valuable to the team right now

---

## Implementation Notes (Phases 1-2)

All work is on branch `feature/realtime-action-board`. Phases 1 and 2 are complete and tested.

### Phase 1 deviations from plan: None. Implemented as specified.

### Phase 2 deviations from plan:

1. **Model mixing is live, not deferred.** The plan suggested all passes use Sonnet initially. Instead, we implemented a hybrid setup immediately:
   - **DeepSeek V3.2** (`deepseek/deepseek-v3.2` via AI Gateway) for: situation, temperature, verification, cross-ticket
   - **Sonnet** for: action items, response draft (these need stronger reasoning and tool use)
   - Controlled by `src/lib/ai/passes/models.ts` — per-pass overrides via env vars (`PASS_MODEL_SITUATION=sonnet`, etc.) or global override (`PASS_MODEL_DEFAULT=sonnet`)

2. **Action item pass required a prompt fix.** The initial prompt didn't enforce that every ticket must have at least one action item. The model would return an empty array for "waiting" tickets. Fixed by adding an explicit instruction that empty action lists are never acceptable.

3. **`analyze-core.ts` is now a thin wrapper.** The 590-line monolithic file was replaced with ~70 lines that delegate to the orchestrator. Types (`ActionItem`, `RelatedTicketInfo`, `TicketActionBoardAnalysis`, `AnalyzeActionBoardResult`) are still exported from `analyze-core.ts` for backward compatibility — other files import them from there.

4. **Test script exists.** `npx tsx src/scripts/test-multi-pass.ts [ticket_id]` runs the full pipeline against a real ticket and prints per-pass results + timing. Uses `.env.local` for credentials.

### Key files created (Phase 1):
- `src/hooks/use-realtime-subscription.ts` — Reusable Supabase Realtime hook
- `supabase/migrations/060_enable_realtime.sql`

### Key files created (Phase 2):
- `src/lib/ai/passes/` — All pass files (types, gather-context, models, orchestrator, 7 pass implementations)
- `src/app/api/queues/support-action-board/analyze-pass/route.ts` — Selective pass trigger endpoint (`POST` with `{ ticketId, passes: [...] }`)
- `supabase/migrations/061_multi_pass_tracking.sql`
- `src/scripts/test-multi-pass.ts`

### Phase 3 deviations from plan:

1. **Dual routing strategy.** The plan suggested either in-memory debouncing or a database queue. We implemented both: `routeEvent()` (async, fires immediately for webhook contexts) and a `processQueuedEvents()` function for batch debouncing. The immediate path is used by default since Vercel serverless can handle the async analysis before the function terminates. The queue-based approach exists as a fallback if debouncing is needed.

2. **`conversation.newMessage` requires conversation-to-ticket lookup.** HubSpot sends conversation thread IDs, not ticket IDs, for message events. The handler queries `support_tickets.hs_conversation_id` to resolve this. If the column doesn't exist yet, this event type will be silently skipped until the sync populates it.

3. **Cron schedule changed.** The plan suggested hourly `mode=changed`. We kept that, but also added a daily full re-analysis at 8am ET (weekdays only) instead of the previous every-10-minute full analysis. This dramatically reduces unnecessary LLM calls while webhooks handle real-time updates.

4. **Internal events are fire-and-forget.** The `complete-action` route emits events without awaiting the result, so the user sees instant completion feedback while analysis runs in the background.

### Key files created (Phase 3):
- `src/lib/events/event-router.ts` — Central event dispatching (event→pass mapping, logging, async analysis trigger)
- `src/lib/events/debounce.ts` — Database-based event queuing and debounced processing
- `src/app/api/webhooks/hubspot/route.ts` — HubSpot webhook receiver (signature verification, event normalization)
- `src/app/api/webhooks/linear/route.ts` — Linear webhook receiver (signature verification, ticket lookup)
- `supabase/migrations/062_webhook_events.sql` — Webhook event logging table
- `src/scripts/test-webhook.ts` — CLI testing script for simulating webhook events

### Key files modified (Phase 3):
- `src/app/api/queues/support-action-board/complete-action/route.ts` — Emits `action_completed` internal event
- `src/app/api/cron/analyze-support/route.ts` — Added `mode=changed` for safety-net cron
- `src/middleware.ts` — Added `/api/webhooks/` to skip list (webhooks verify their own signatures)
- `vercel.json` — Changed cron from every-10-min full to hourly changed + daily full

### Phase 3 deployment lessons (important for future phases):

1. **Middleware blocks new API routes by default.** `src/middleware.ts` requires Supabase auth on all `/api/` routes. New public routes (webhooks, external callbacks) MUST be added to the skip list in middleware, or they'll 401 before reaching the handler. See `WEBHOOK_ROUTES` array.

2. **Vercel serverless kills async work after response.** Never use fire-and-forget (`promise.catch()` without `await`) for work that calls external APIs. The function gets killed after the response is sent. Webhook handlers must use `routeEventSync()` (awaits analysis) not `routeEvent()` (fire-and-forget). The `routeEvent()` function still exists but should only be used from contexts where the caller already awaits (e.g., internal events from `complete-action` where it's ok if the verification pass fails silently).

3. **HubSpot signature verification uses the public URL.** The `verifyHubSpotSignature` function hardcodes the public Vercel domain (`hub-agent-oe65.vercel.app`) because Vercel's internal `request.url` includes deployment-specific subdomains that don't match what HubSpot used to compute the signature. If the domain changes, update the `publicUrl` constant in `src/app/api/webhooks/hubspot/route.ts`.

4. **Linear webhook not yet registered.** The handler code exists and `LINEAR_WEBHOOK_SECRET` is in `.env.local` (blank). Linear webhooks haven't been set up in Linear's settings yet — low priority since most events come from HubSpot.

5. **`conversation.newMessage` depends on `hs_conversation_id` column.** This column may not exist on `support_tickets` yet. Until the sync populates it, customer/agent message events from HubSpot conversations will be silently ignored (ticket lookup returns null).

### Phase 4 deviations from plan:

1. **Centralized DB operations module.** Instead of scattering Supabase calls across passes and endpoints, created `src/lib/ai/passes/action-items-db.ts` which centralizes all action_items table reads/writes (getActiveActionItems, insertActionItems, supersedeActionItems, completeActionItems, expireActionItems) and event logging. All passes and API routes use this module.

2. **Backward compatibility is dual-write.** The action-item-pass writes to both the new `action_items` table AND returns the combined items for the JSONB column in `ticket_action_board_analyses`. The complete-action endpoint writes to both `action_items` and legacy `action_item_completions`. The GET endpoint fetches from both tables (action_items for living items, action_item_completions for legacy). The UI gracefully falls back to JSONB data if no living items exist for a ticket.

3. **Auto-complete check runs before analysis on agent_message.** The event router runs `runAutoCompleteCheck()` before the standard analysis passes for `agent_message` events. This ensures items are auto-completed before the action-item-pass runs its keep/supersede/new evaluation. The check only fires if `event.metadata.messageText` is present.

4. **Implicitly dropped items are superseded.** If the LLM doesn't mention an existing item in either KEEP_ITEMS or SUPERSEDE_ITEMS, it's treated as implicitly superseded with reason "Implicitly replaced by updated analysis". This prevents orphaned active items.

5. **Safety net for empty results.** If the LLM supersedes all items but doesn't create new ones, the pass logs a warning and falls back to keeping the existing items rather than leaving the ticket with zero action items.

6. **HubSpot webhook fetches message text.** The webhook handler now calls HubSpot's conversations API to fetch the actual message body for `agent_message` events (via `fetchMessageText()`). This was necessary because HubSpot's webhook payload only says "a message happened" — it doesn't include the text. Without this, auto-complete detection would never fire.

### Key files created (Phase 4):
- `src/lib/ai/passes/action-items-db.ts` — Centralized action_items table operations
- `src/lib/ai/passes/auto-complete-check.ts` — Auto-completion detection from agent messages
- `src/lib/ai/passes/staleness-check.ts` — Background relevance checking for old items
- `src/app/api/cron/action-item-staleness/route.ts` — Cron endpoint (every 15 min)
- `supabase/migrations/063_action_items_table.sql` — New tables + data migration

### Key files modified (Phase 4):
- `src/lib/ai/passes/action-item-pass.ts` — Keep/supersede/new lifecycle logic
- `src/lib/events/event-router.ts` — Auto-complete check on agent_message events
- `src/app/api/queues/support-action-board/route.ts` — Fetches from action_items table, new LiveActionItem type
- `src/app/api/queues/support-action-board/complete-action/route.ts` — Dual-write to action_items + legacy table
- `src/components/dashboard/queues/support-action-board-view.tsx` — Lifecycle-aware rendering, ActionItemCard component, realtime subscription
- `vercel.json` — Added action-item-staleness cron

### Key files also modified (Phase 4):
- `src/app/api/webhooks/hubspot/route.ts` — Fetches message text for agent_message events (enables auto-complete)
- `src/scripts/test-living-action-items.ts` — End-to-end test script for the full lifecycle

### Phase 5 deviations from plan:

1. **No quality dashboard UI.** The plan listed a quality metrics view (Step 5) as optional. Not built — quality data is in the `quality_reviews` table for future use.

2. **Batch analysis skips quality review.** The `batch-analyze` route now calls `runAnalysisPipeline` directly with `skipQualityReview: true` instead of going through `analyzeActionBoardTicket`. This avoids the latency penalty (~26s per ticket) during bulk operations.

3. **Refinement runs once by default.** `QUALITY_MAX_REFINEMENT_ATTEMPTS` defaults to 1. The plan showed a re-review loop; the code supports multiple attempts but one pass is sufficient in practice.

4. **`pass_approved` uses the env threshold, not the LLM's judgment.** The reviewer outputs PASS_APPROVED but we override it based on `QUALITY_REVIEW_THRESHOLD` (default 0.70) to keep control with the operator.

### Key files created (Phase 5):
- `src/lib/ai/passes/quality-review-pass.ts` — 6-dimension quality evaluation
- `src/lib/ai/passes/refinement-pass.ts` — Targeted fix for flagged fields
- `supabase/migrations/064_quality_reviews.sql` — Quality metrics storage
- `src/scripts/test-quality-layers.ts` — End-to-end test

### Key files modified (Phase 5):
- `src/lib/ai/passes/orchestrator.ts` — Quality review + refinement integrated as final pipeline step; `AnalysisOptions.skipQualityReview` added; `applyRefinements()` merges fixes
- `src/lib/ai/passes/types.ts` — Added `QualityReviewResult`, `QualityIssue`, `RefinementResult` types; `quality_review` and `refinement` PassTypes
- `src/lib/ai/passes/models.ts` — `quality_review` and `refinement` route to Sonnet by default
- `src/app/api/queues/support-action-board/batch-analyze/route.ts` — Skips quality review

### Env vars (Phase 5):
- `QUALITY_REVIEW_ENABLED` — `true`/`false` (default: `true`)
- `QUALITY_REVIEW_THRESHOLD` — min score to pass (default: `0.70`)
- `QUALITY_MAX_REFINEMENT_ATTEMPTS` — max retries (default: `1`)

### Branch status:
All phases (1-5) are merged to `main`. Next phase should branch from `main`.
