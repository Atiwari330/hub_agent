# Phase 2: Multi-Pass Specialized Analysis — COMPLETE

> **Status:** Implemented and tested on `feature/realtime-action-board`. Migration `061_multi_pass_tracking.sql` must be run on Supabase. See `00-overview.md` "Implementation Notes" section for deviations (model mixing is live, action item prompt was fixed, test script exists).

## Goal

Replace the single monolithic LLM call (which tries to produce 12 different outputs at once) with a pipeline of **focused, specialized passes** — each one doing one thing well. This improves quality on every dimension, enables independent triggering of specific passes, and unlocks model mixing (cheap fast models for simple passes, strong models for complex ones).

## Why This Phase Matters

The current `analyzeActionBoardTicket()` function in `analyze-core.ts` asks one LLM call to simultaneously:
- Summarize the situation
- Generate action items with specific formatting
- Assess customer temperature
- Calculate timing metrics
- Verify action completions
- Analyze cross-ticket coordination
- Rate its own confidence
- Track knowledge usage

That's a lot of cognitive load for one call. The result: action items are sometimes generic, temperature assessments miss nuance, and verification flags are inconsistent. Splitting into focused passes means each one gets a simpler, more targeted prompt — and the output is better.

This phase also creates the architecture that Phases 3-7 depend on. Event-driven triggers (Phase 3) need to dispatch to specific passes. Living action items (Phase 4) need an independent action pass. Quality review (Phase 5) needs individual pass outputs to critique.

---

## Current State

**File:** `src/app/api/queues/support-action-board/analyze/analyze-core.ts`

- `buildSystemPrompt()` — Single ~150-line system prompt covering all 12 output fields
- `analyzeActionBoardTicket()` — Gathers context (ticket, conversations, engagements, Linear, related tickets, completions), makes one `generateText()` call, parses structured text output via regex
- Uses `getSonnetModel()` (Claude Sonnet) for all analysis
- Model has access to one tool: `lookupSupportKnowledge`
- Output parsed into `TicketActionBoardAnalysis` type and upserted to DB
- Verification flags parsed from text and used to update `action_item_completions`

---

## Target State

### Pass Pipeline Architecture

Each pass is an independent function that:
- Takes specific context it needs (not everything)
- Calls an LLM with a focused prompt
- Returns a typed result
- Writes its output to a specific DB location

```
analyzeActionBoardTicket(ticketId, options?)
  │
  ├─→ gatherContext(ticketId)          // Shared step: fetch all data once
  │     Returns: TicketContext object
  │
  ├─→ runSituationPass(context)        // Summary + context snapshot
  ├─→ runActionItemPass(context)       // Action items (depends on situation)
  ├─→ runTemperaturePass(context)      // Customer sentiment analysis
  ├─→ runTimingPass(context)           // Hours-since calculations (no LLM needed)
  ├─→ runVerificationPass(context)     // Audit claimed completions
  ├─→ runCrossTicketPass(context)      // Related ticket coordination
  └─→ runResponseDraftPass(context)    // Draft response for agent to edit
        │
        ├─→ composeFinalAnalysis()     // Merge all pass outputs
        └─→ upsertToDb()              // Write to ticket_action_board_analyses
```

### Individual Pass Definitions

#### 1. Situation Pass
- **Input:** Ticket metadata, conversation thread, engagement timeline, Linear context
- **Output:** `situation_summary` (string), `context_snapshot` (string)
- **Model:** Fast/cheap (Haiku, DeepSeek, GPT-4o-mini)
- **Prompt focus:** "Summarize this ticket for someone with zero context. What's going on, where do things stand?"
- **Token budget:** ~200 output tokens

#### 2. Action Item Pass
- **Input:** Ticket metadata, conversation thread, engagement timeline, Linear context, customer knowledge, situation summary (from pass 1), existing action items + completions
- **Output:** `action_items` (ActionItem[])
- **Model:** Strong (Sonnet, GPT-4o) — this is the most important pass
- **Prompt focus:** "Generate specific, self-contained, executable action items to move this ticket forward. Consider what's already been done and what's still pending."
- **Includes:** All the current rules about team-based actions, ticket hygiene, VIP handling, Copilot escalation, missing Linear tasks, etc.
- **Token budget:** ~500 output tokens
- **Key improvement:** The prompt for action items can be much more detailed and specific since it's not competing with 11 other output requirements

#### 3. Temperature Pass
- **Input:** Conversation thread (full text, not truncated), ticket metadata (timestamps)
- **Output:** `customer_temperature` (string), `temperature_reason` (string)
- **Model:** Fast/cheap — sentiment analysis is a simpler task
- **Prompt focus:** "Analyze the customer's tone, word choice, and communication patterns. How are they feeling? Is the trend getting better or worse?"
- **Token budget:** ~100 output tokens
- **Key improvement:** Can analyze the FULL conversation without truncation since this pass only needs conversation text, not all the other context

#### 4. Timing Pass
- **Input:** Ticket metadata timestamps only
- **Output:** `hours_since_customer_waiting`, `hours_since_last_outbound`, `hours_since_last_activity`
- **Model:** NONE — this is pure computation, no LLM needed
- **Key improvement:** Currently the LLM calculates these (error-prone). Moving to pure code eliminates hallucinated timing values

```typescript
function runTimingPass(context: TicketContext): TimingResult {
  const now = Date.now();
  const lastCustomer = context.ticket.last_customer_message_at
    ? new Date(context.ticket.last_customer_message_at).getTime() : null;
  const lastAgent = context.ticket.last_agent_message_at
    ? new Date(context.ticket.last_agent_message_at).getTime() : null;

  // Customer is waiting only if their last message is more recent than agent's
  const customerWaiting = (lastCustomer && (!lastAgent || lastCustomer > lastAgent))
    ? (now - lastCustomer) / (1000 * 60 * 60)
    : 0;

  const lastOutbound = lastAgent
    ? (now - lastAgent) / (1000 * 60 * 60)
    : null;

  // Last activity = most recent of any timestamp
  const allTimestamps = [lastCustomer, lastAgent].filter(Boolean) as number[];
  const lastActivity = allTimestamps.length > 0
    ? (now - Math.max(...allTimestamps)) / (1000 * 60 * 60)
    : null;

  return {
    hours_since_customer_waiting: Math.round(customerWaiting * 100) / 100,
    hours_since_last_outbound: lastOutbound ? Math.round(lastOutbound * 100) / 100 : null,
    hours_since_last_activity: lastActivity ? Math.round(lastActivity * 100) / 100 : null,
  };
}
```

#### 5. Verification Pass
- **Input:** Action item completions (from DB), engagement timeline, conversation thread
- **Output:** Array of `{ completionId, verified: boolean, verificationNote: string }`
- **Model:** Fast/cheap — matching claimed actions to evidence
- **Prompt focus:** "For each claimed completion, verify whether the action actually happened based on the engagement timeline."
- **Token budget:** ~200 output tokens
- **Only runs when:** There are unverified completions to check

#### 6. Cross-Ticket Pass
- **Input:** Related open tickets + their analyses, current ticket summary
- **Output:** `related_ticket_notes` (string), `related_tickets` (RelatedTicketInfo[])
- **Model:** Fast/cheap
- **Prompt focus:** "Are there coordination needs between these tickets from the same company?"
- **Only runs when:** The ticket's company has other open tickets
- **Token budget:** ~150 output tokens

#### 7. Response Draft Pass
- **Input:** Ticket metadata, conversation thread, action items (from pass 2), customer temperature (from pass 3), customer knowledge
- **Output:** `response_draft` (string), `response_guidance` (string)
- **Model:** Strong (Sonnet) — output is customer-facing
- **Prompt focus:** "Draft a response the agent can edit and send. Match the appropriate tone for the customer's current temperature. Address the highest-priority action items."
- **Token budget:** ~400 output tokens
- **Key improvement:** Currently `response_guidance` and `response_draft` are null in the analysis. This pass makes them real, actionable drafts.

---

## Implementation Details

### Step 1: Create Pass Infrastructure

**New file:** `src/lib/ai/passes/types.ts`

Define types for each pass's input and output:

```typescript
export interface TicketContext {
  ticket: SupportTicket;           // From support_tickets table
  ownerName: string | null;
  conversationMessages: ThreadMessage[];
  conversationText: string;
  engagementTimeline: EngagementTimeline;
  engagementTimelineText: string;
  linearContext: LinearIssueContext | null;
  customerContext: string | null;
  relatedTickets: RelatedTicketData[];
  recentCompletions: CompletionData[];
  ageDays: number | null;
}

export interface SituationPassResult {
  situation_summary: string;
  context_snapshot: string;
}

export interface ActionItemPassResult {
  action_items: ActionItem[];
  status_tags: string[];
}

export interface TemperaturePassResult {
  customer_temperature: string;
  temperature_reason: string;
}

export interface TimingPassResult {
  hours_since_customer_waiting: number;
  hours_since_last_outbound: number | null;
  hours_since_last_activity: number | null;
}

export interface VerificationPassResult {
  verifications: Array<{
    completionId: string;
    verified: boolean;
    note: string;
  }>;
}

export interface CrossTicketPassResult {
  related_ticket_notes: string;
  related_tickets: RelatedTicketInfo[];
}

export interface ResponseDraftPassResult {
  response_draft: string;
  response_guidance: string;
}
```

### Step 2: Implement Individual Pass Functions

**New directory:** `src/lib/ai/passes/`

Each pass gets its own file:
- `src/lib/ai/passes/situation-pass.ts`
- `src/lib/ai/passes/action-item-pass.ts`
- `src/lib/ai/passes/temperature-pass.ts`
- `src/lib/ai/passes/timing-pass.ts` (no LLM)
- `src/lib/ai/passes/verification-pass.ts`
- `src/lib/ai/passes/cross-ticket-pass.ts`
- `src/lib/ai/passes/response-draft-pass.ts`

Each file exports a single function: `runXxxPass(context: TicketContext, deps?: DependencyResults): Promise<XxxPassResult>`

The `deps` parameter allows passing results from earlier passes (e.g., the action item pass receives the situation summary).

### Step 3: Create Pass Orchestrator

**New file:** `src/lib/ai/passes/orchestrator.ts`

```typescript
export interface AnalysisOptions {
  passes?: PassType[];          // Which passes to run (default: all)
  skipIfFresh?: boolean;        // Skip passes whose output is newer than threshold
  freshnessThresholdMs?: number; // How old a pass result can be before re-running (default: 15 min)
}

export type PassType = 'situation' | 'action_items' | 'temperature' | 'timing'
  | 'verification' | 'cross_ticket' | 'response_draft';

export async function runAnalysisPipeline(
  ticketId: string,
  options?: AnalysisOptions
): Promise<TicketActionBoardAnalysis> {
  // 1. Gather context (shared across all passes)
  const context = await gatherTicketContext(ticketId);

  // 2. Determine which passes to run
  const passesToRun = options?.passes || ALL_PASSES;

  // 3. Run independent passes in parallel where possible
  //    - Situation, Temperature, Timing, Verification, Cross-Ticket: parallel
  //    - Action Items: after Situation (needs summary as input)
  //    - Response Draft: after Action Items + Temperature (needs both)

  // Phase 1: Parallel independent passes
  const [situationResult, temperatureResult, timingResult, verificationResult, crossTicketResult] =
    await Promise.all([
      passesToRun.includes('situation') ? runSituationPass(context) : null,
      passesToRun.includes('temperature') ? runTemperaturePass(context) : null,
      runTimingPass(context), // always run, it's free (no LLM)
      passesToRun.includes('verification') && context.recentCompletions.length > 0
        ? runVerificationPass(context) : null,
      passesToRun.includes('cross_ticket') && context.relatedTickets.length > 0
        ? runCrossTicketPass(context) : null,
    ]);

  // Phase 2: Dependent passes
  const actionResult = passesToRun.includes('action_items')
    ? await runActionItemPass(context, { situationSummary: situationResult?.situation_summary })
    : null;

  const responseResult = passesToRun.includes('response_draft')
    ? await runResponseDraftPass(context, {
        actionItems: actionResult?.action_items,
        temperature: temperatureResult?.customer_temperature,
      })
    : null;

  // 4. Compose final analysis from all pass results
  const analysis = composeFinalAnalysis(ticketId, context, {
    situation: situationResult,
    actionItems: actionResult,
    temperature: temperatureResult,
    timing: timingResult,
    verification: verificationResult,
    crossTicket: crossTicketResult,
    responseDraft: responseResult,
  });

  // 5. Upsert to DB
  await upsertAnalysis(analysis);

  // 6. Apply verification updates
  if (verificationResult) {
    await applyVerifications(ticketId, verificationResult);
  }

  return analysis;
}
```

### Step 4: Extract Context Gathering

Move the data gathering logic (steps 1-11 of current `analyzeActionBoardTicket`) into a shared function:

**New file:** `src/lib/ai/passes/gather-context.ts`

This function does all the same work the current analyze-core.ts does (fetch ticket, owner, conversations, engagements, Linear, customer knowledge, related tickets, completions) but returns a clean `TicketContext` object instead of building a giant string prompt.

### Step 5: Refactor `analyze-core.ts`

**Modified file:** `src/app/api/queues/support-action-board/analyze/analyze-core.ts`

Replace the current implementation with:

```typescript
export async function analyzeActionBoardTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeActionBoardResult> {
  try {
    const analysis = await runAnalysisPipeline(ticketId, {
      passes: ['situation', 'action_items', 'temperature', 'timing',
               'verification', 'cross_ticket', 'response_draft'],
    });
    return { success: true, analysis };
  } catch (error) {
    return { success: false, error: 'Failed to analyze ticket', details: error.message };
  }
}
```

The function signature stays the same, so `batch-analyze/route.ts`, the cron job, and the single-ticket route all work without changes.

### Step 6: Add Selective Pass Triggering

Add a new API endpoint for triggering specific passes:

**New file:** `src/app/api/queues/support-action-board/analyze-pass/route.ts`

```typescript
// POST /api/queues/support-action-board/analyze-pass
// Body: { ticketId: string, passes: PassType[] }
//
// This enables Phase 3 (webhooks) to trigger only the relevant passes:
// - Customer replies → ['situation', 'action_items', 'temperature', 'timing', 'response_draft']
// - Agent sends response → ['verification', 'timing', 'action_items']
// - Linear state change → ['situation', 'action_items']
// - Action marked complete → ['verification']
```

---

## Model Selection Per Pass

| Pass | Recommended Model | Rationale |
|------|-------------------|-----------|
| Situation | Haiku / DeepSeek | Simple summarization task |
| Action Items | Sonnet / GPT-4o | Most important output, needs strong reasoning |
| Temperature | Haiku / DeepSeek | Sentiment analysis is well-understood |
| Timing | None (code) | Pure math |
| Verification | Haiku / DeepSeek | Pattern matching against evidence |
| Cross-Ticket | Haiku / DeepSeek | Lightweight coordination check |
| Response Draft | Sonnet | Customer-facing output needs quality |

Create a model selection utility:

**New file:** `src/lib/ai/passes/models.ts`

```typescript
// Maps pass types to model providers
// Allows easy swapping of models per pass
// Reads from env vars for flexibility:
//   PASS_MODEL_SITUATION=haiku
//   PASS_MODEL_ACTION_ITEMS=sonnet
//   etc.
// Falls back to getSonnetModel() if not specified
```

---

## Database Changes

**Migration:** `supabase/migrations/XXX_multi_pass_tracking.sql`

```sql
-- Track when each pass was last run for a ticket
-- This enables selective re-running of only stale passes
ALTER TABLE ticket_action_board_analyses
  ADD COLUMN IF NOT EXISTS pass_versions JSONB DEFAULT '{}';
  -- Example: { "situation": "2026-03-24T10:00:00Z", "action_items": "2026-03-24T10:00:00Z", ... }

-- Optional: Store individual pass results separately for history
-- (Used by Phase 7: Contextual Memory)
CREATE TABLE IF NOT EXISTS analysis_pass_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL REFERENCES support_tickets(hubspot_ticket_id) ON DELETE CASCADE,
  pass_type TEXT NOT NULL,
  result JSONB NOT NULL,
  model_used TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Index for querying pass history
  CONSTRAINT unique_pass_per_ticket_time UNIQUE (hubspot_ticket_id, pass_type, created_at)
);

CREATE INDEX idx_pass_results_ticket ON analysis_pass_results(hubspot_ticket_id, pass_type);
CREATE INDEX idx_pass_results_created ON analysis_pass_results(created_at);
```

---

## Testing Plan

1. **Pass isolation**: Run each pass independently against a real ticket and verify the output format is correct
2. **Pipeline composition**: Run the full pipeline and verify the composed analysis matches the expected `TicketActionBoardAnalysis` shape
3. **Backward compatibility**: Verify that `analyzeActionBoardTicket()` still produces the same output format — the batch-analyze route, cron job, and UI should all work without changes
4. **Selective passes**: Call the new `analyze-pass` endpoint with only `['temperature']` and verify only the temperature fields update while others remain unchanged
5. **Parallelism**: Verify that independent passes run in parallel (situation + temperature + timing should complete in roughly the same time as the slowest one, not the sum)
6. **Model mixing**: Configure different models per pass and verify each pass uses the correct model
7. **Performance comparison**: Run old monolithic analysis vs new multi-pass pipeline on the same ticket set. Compare: total time, output quality (subjective review), token usage

### Quick Smoke Test

```bash
# After implementation, run against a specific ticket:
npx tsx src/scripts/test-multi-pass.ts <ticket_id>

# This script should:
# 1. Run gatherContext and print what was gathered
# 2. Run each pass individually and print results
# 3. Run full pipeline and print composed analysis
# 4. Compare with old monolithic analysis on same ticket
```

---

## Rollback Strategy

The refactored `analyzeActionBoardTicket()` maintains the same signature and return type. If issues arise:
- Revert `analyze-core.ts` to the old monolithic implementation
- The orchestrator and pass files can remain in the codebase without being called
- No database schema changes are destructive (new columns are additive)

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/ai/passes/types.ts` | CREATE | Type definitions for all pass inputs/outputs |
| `src/lib/ai/passes/gather-context.ts` | CREATE | Shared context gathering (extracted from analyze-core) |
| `src/lib/ai/passes/orchestrator.ts` | CREATE | Pipeline orchestrator with parallel execution |
| `src/lib/ai/passes/models.ts` | CREATE | Model selection per pass type |
| `src/lib/ai/passes/situation-pass.ts` | CREATE | Situation summary pass |
| `src/lib/ai/passes/action-item-pass.ts` | CREATE | Action item generation pass |
| `src/lib/ai/passes/temperature-pass.ts` | CREATE | Customer sentiment pass |
| `src/lib/ai/passes/timing-pass.ts` | CREATE | Timing calculation (no LLM) |
| `src/lib/ai/passes/verification-pass.ts` | CREATE | Completion verification pass |
| `src/lib/ai/passes/cross-ticket-pass.ts` | CREATE | Cross-ticket coordination pass |
| `src/lib/ai/passes/response-draft-pass.ts` | CREATE | Response draft generation pass |
| `src/app/api/queues/support-action-board/analyze/analyze-core.ts` | MODIFY | Delegate to orchestrator |
| `src/app/api/queues/support-action-board/analyze-pass/route.ts` | CREATE | Selective pass trigger endpoint |
| `supabase/migrations/XXX_multi_pass_tracking.sql` | CREATE | Pass versioning + results storage |
