# Phase 4: Living Action Items

## Goal

Transform action items from static snapshots into a **continuously curated task queue** with a full lifecycle: birth, validation, monitoring, completion detection, expiration, and replacement. Action items should always reflect the current state of the ticket — never feel outdated.

## Why This Phase Exists

This is the core pain point. Today, action items are generated at analysis time and freeze. A customer might reply 5 minutes later answering a question the action item says to ask them. The action item sits there, stale and misleading, until someone re-analyzes. Agents learn to distrust the action items, which defeats the purpose of the board.

With living action items, the system continuously manages the action list — detecting completions automatically, expiring irrelevant items, and generating new ones in response to events.

---

## Current State

### How Action Items Work Today

1. **Generated:** During `analyzeActionBoardTicket()` in `analyze-core.ts` (line 96-106 of the system prompt)
2. **Stored:** As a JSONB array in `ticket_action_board_analyses.action_items`
3. **Completed:** Agent clicks checkbox → POST to `complete-action/route.ts` → row in `action_item_completions`
4. **Verified:** Next full re-analysis checks completions against engagement timeline (lines 137-140 of prompt, lines 506-536 of analyze-core.ts)
5. **Replaced:** On re-analysis, the entire `action_items` array is overwritten. Old items are gone.

### Problems

- Action items are only refreshed on full re-analysis (every 10 min or manual trigger)
- No concept of "this action item is no longer relevant"
- No auto-detection of completions (agent must manually click checkbox)
- Completion verification only happens during the next full analysis
- When analysis overwrites action items, previous completion records may reference items that no longer exist (orphaned completions)
- No history of action item changes — you can't see how the action list evolved

---

## Target State

### Action Item Lifecycle

```
                    ┌─── CREATED ───┐
                    │  (via analysis │
                    │   or event)    │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   ACTIVE      │ ← Normal state, displayed prominently
                    └───┬───┬───┬───┘
                        │   │   │
            ┌───────────┘   │   └───────────┐
            ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ COMPLETED │   │ SUPERSEDED│   │  EXPIRED  │
    │ (manual   │   │ (replaced │   │ (no longer│
    │  or auto) │   │  by newer │   │  relevant)│
    └───────────┘   │  action)  │   └───────────┘
                    └───────────┘
```

### Key Behaviors

1. **Auto-completion detection:** After an agent sends an email (via webhook event), the system runs a quick LLM check: "Did this email address any of the active action items?" If yes, mark them as auto-completed.

2. **Event-driven generation:** When a customer replies, new action items are generated that respond to what they said. Old items that are no longer relevant are marked as superseded.

3. **Staleness detection:** A background check (every 15-30 min) asks: "Given the current ticket state, are these action items still relevant?" Irrelevant items get expired.

4. **Progressive specificity:** When a ticket first opens, action items are broad. As more context arrives, they become specific. The system doesn't just regenerate from scratch — it refines.

5. **History preservation:** Action items are stored individually (not as a JSON array in the analysis). You can see the full evolution of what was suggested, what was done, what was superseded.

---

## Implementation Details

### Step 1: Separate Action Items Table

Move action items from a JSONB array in `ticket_action_board_analyses` to their own table:

**New migration:** `supabase/migrations/XXX_action_items_table.sql`

```sql
-- Individual action items with lifecycle tracking
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT NOT NULL,                    -- e.g., "act_1" (from LLM)
  hubspot_ticket_id TEXT NOT NULL REFERENCES support_tickets(hubspot_ticket_id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT 'any_support_agent',  -- any_support_agent | engineering | cs_manager
  priority TEXT NOT NULL DEFAULT 'today',          -- now | today | this_week
  status TEXT NOT NULL DEFAULT 'active',           -- active | completed | superseded | expired
  status_tags TEXT[] DEFAULT '{}',

  -- Lifecycle metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_pass TEXT,              -- 'action_items', 'event_customer_message', etc.
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  completed_method TEXT,             -- 'manual' | 'auto_detected'
  superseded_by TEXT,                -- ID of the action item that replaced this one
  superseded_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  expired_reason TEXT,

  -- Verification
  verified BOOLEAN,
  verification_note TEXT,
  verified_at TIMESTAMPTZ,

  -- For ordering within a ticket
  sort_order INTEGER DEFAULT 0,

  PRIMARY KEY (id, hubspot_ticket_id)
);

CREATE INDEX idx_action_items_ticket ON action_items(hubspot_ticket_id, status);
CREATE INDEX idx_action_items_active ON action_items(hubspot_ticket_id) WHERE status = 'active';
CREATE INDEX idx_action_items_created ON action_items(created_at);

-- Migrate existing action items from analyses
-- This migration should read ticket_action_board_analyses.action_items JSONB
-- and insert each item into the new table with status='active'
INSERT INTO action_items (id, hubspot_ticket_id, description, who, priority, status, status_tags, created_at)
SELECT
  item->>'id',
  a.hubspot_ticket_id,
  item->>'description',
  COALESCE(item->>'who', 'any_support_agent'),
  COALESCE(item->>'priority', 'today'),
  'active',
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(item->'status_tags')),
    '{}'
  ),
  a.analyzed_at
FROM ticket_action_board_analyses a,
     jsonb_array_elements(a.action_items) AS item
WHERE a.action_items IS NOT NULL
  AND jsonb_array_length(a.action_items) > 0
ON CONFLICT DO NOTHING;

-- Migrate existing completions to update the new table
UPDATE action_items ai
SET
  status = 'completed',
  completed_at = c.completed_at,
  completed_by = c.completed_by,
  completed_method = 'manual',
  verified = c.verified,
  verification_note = c.verification_note
FROM action_item_completions c
WHERE ai.id = c.action_item_id
  AND ai.hubspot_ticket_id = c.hubspot_ticket_id;

-- Action item change log (for history)
CREATE TABLE IF NOT EXISTS action_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
  action_item_id TEXT NOT NULL,
  event_type TEXT NOT NULL,       -- 'created' | 'completed' | 'auto_completed' | 'superseded' | 'expired' | 'priority_changed'
  details JSONB,                  -- Event-specific data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_item_events_ticket ON action_item_events(hubspot_ticket_id);
```

### Step 2: Refactor Action Item Pass

**Modified file:** `src/lib/ai/passes/action-item-pass.ts` (from Phase 2)

The action item pass now receives the current active action items and must decide:
- Which existing items are still relevant → keep as-is
- Which existing items are no longer relevant → mark as superseded
- What new items need to be created

```typescript
// Updated prompt structure for the action item pass:
//
// CURRENT ACTIVE ACTION ITEMS:
// [list of existing active items with IDs]
//
// YOUR JOB:
// 1. Review each existing action item against the current ticket state
// 2. For items that are STILL relevant and accurate: include them in KEEP_ITEMS
// 3. For items that are NO LONGER relevant: include them in SUPERSEDE_ITEMS with reason
// 4. For NEW actions needed: include them in NEW_ITEMS
//
// Output format:
// KEEP_ITEMS: [array of existing item IDs to keep]
// SUPERSEDE_ITEMS: [array of { id, reason }]
// NEW_ITEMS: [array of new ActionItem objects]
```

This approach preserves continuity — agents don't see their entire action list disappear and reappear with different items every 10 minutes.

### Step 3: Auto-Completion Detection

**New file:** `src/lib/ai/passes/auto-complete-check.ts`

Triggered when an agent sends a response (webhook event type: `agent_message`):

```typescript
// This is a lightweight LLM call:
//
// Input:
// - The agent's message (from webhook or engagement timeline)
// - List of currently active action items for this ticket
//
// Prompt:
// "An agent just sent the following response to the customer:
//  [message text]
//
//  Here are the currently active action items for this ticket:
//  [list of active items with IDs]
//
//  Which action items (if any) does this response address or complete?
//  Only mark an item as completed if the response DIRECTLY addresses it.
//
//  Output: COMPLETED_ITEMS: [array of item IDs] or NONE"
//
// Model: Haiku/DeepSeek (simple matching task)
// Token budget: ~100 output tokens
```

When items are auto-completed:
1. Update `action_items` table: `status = 'completed'`, `completed_method = 'auto_detected'`
2. Log to `action_item_events`
3. Supabase Realtime broadcasts the change → UI updates (Phase 1)

### Step 4: Staleness Monitor

**New file:** `src/lib/ai/passes/staleness-check.ts`

A lightweight background process that runs every 15-30 minutes:

```typescript
// For each ticket with active action items:
// 1. Check how old each action item is
// 2. Check if the ticket state has changed since the item was created
// 3. For items older than a threshold (e.g., 4 hours) where the ticket has had activity:
//    Run a quick LLM check asking "Is this action item still relevant?"
//
// This is NOT a full re-analysis. It's a targeted relevance check.
// Items deemed irrelevant get status='expired' with a reason.
```

**New cron endpoint:** `src/app/api/cron/action-item-staleness/route.ts`

```typescript
// GET /api/cron/action-item-staleness
// Schedule: every 15 minutes during business hours
//
// 1. Query action_items WHERE status='active' AND created_at < NOW() - interval '2 hours'
// 2. Group by ticket
// 3. For each ticket: check if any activity occurred after the item was created
// 4. If yes: run staleness check LLM pass
// 5. Update expired items
```

### Step 5: Update UI to Use New Action Items Table

**Modified file:** `src/components/dashboard/queues/support-action-board-view.tsx`

Changes:
- Fetch action items from the new `action_items` table instead of from `analysis.action_items` JSONB
- Show action item status visually:
  - **Active**: Normal display (current behavior)
  - **Completed (manual)**: Strikethrough + green checkmark + "Completed by [name]"
  - **Completed (auto)**: Strikethrough + green sparkle icon + "Auto-detected as completed"
  - **Superseded**: Dim/collapsed + "Superseded: [reason]" — visible but not prominent
  - **Expired**: Hidden by default, shown with a "Show expired" toggle
- Show action item creation context: "Generated because customer replied" or "Generated during full analysis"
- Show age of each action item: "2h ago", "30m ago"

### Step 6: Update Action Board GET Endpoint

**Modified file:** `src/app/api/queues/support-action-board/route.ts`

Instead of reading `analysis.action_items` from the JSONB column, query the `action_items` table:

```typescript
// Replace:
//   action_items from ticket_action_board_analyses.action_items JSONB
// With:
//   SELECT * FROM action_items WHERE hubspot_ticket_id IN (...) AND status = 'active'
//   (Plus completed items from last 24h for context)
```

Also include action item counts per ticket in the response for the collapsed view.

### Step 7: Update Complete-Action Endpoint

**Modified file:** `src/app/api/queues/support-action-board/complete-action/route.ts`

Instead of writing to `action_item_completions`, update the `action_items` table directly:

```typescript
// Update action_items SET status='completed', completed_by=userId,
//   completed_at=now(), completed_method='manual'
// WHERE id=actionItemId AND hubspot_ticket_id=ticketId
//
// Also log to action_item_events
```

The `action_item_completions` table becomes redundant and can be deprecated (keep for historical data).

### Step 8: Backward Compatibility

During transition, maintain both:
- The `action_items` JSONB column in `ticket_action_board_analyses` (for the trainer and manager queues which still read it)
- The new `action_items` table (for the action board)

The orchestrator's compose step should still populate `analysis.action_items` from the active items in the new table, so the existing analysis upsert works.

---

## Testing Plan

1. **Migration verification**: After running the migration, verify all existing action items are in the new table with correct status
2. **Action item generation**: Trigger analysis on a ticket. Verify new action items appear in the `action_items` table with `created_by_pass` populated
3. **Manual completion**: Complete an action item via the UI. Verify the row in `action_items` updates to `status='completed'` with `completed_method='manual'`
4. **Auto-completion detection**: Send a response on a ticket that addresses an active action item. Verify the item is auto-completed with `completed_method='auto_detected'`
5. **Supersession**: Trigger a re-analysis after a customer reply. Verify that outdated items are marked superseded and new relevant items are created
6. **Staleness expiration**: Create an action item, wait for the staleness check, and verify items for resolved/changed tickets get expired
7. **UI lifecycle display**: Verify each status (active, completed, superseded, expired) renders correctly with appropriate visual treatment
8. **History trail**: Check `action_item_events` table for a complete log of lifecycle changes

### Diagnostic Script

```bash
# Inspect action item lifecycle for a ticket:
npx tsx src/scripts/inspect-action-items.ts <ticket_id>

# Should output:
# - All action items (active, completed, superseded, expired)
# - Lifecycle events for each item
# - Timeline of changes
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/XXX_action_items_table.sql` | CREATE | New action_items + action_item_events tables, data migration |
| `src/lib/ai/passes/action-item-pass.ts` | MODIFY | Keep/supersede/create logic instead of regenerate-all |
| `src/lib/ai/passes/auto-complete-check.ts` | CREATE | Auto-detect completions from agent messages |
| `src/lib/ai/passes/staleness-check.ts` | CREATE | Background relevance checking |
| `src/app/api/cron/action-item-staleness/route.ts` | CREATE | Cron endpoint for staleness monitor |
| `src/app/api/queues/support-action-board/route.ts` | MODIFY | Read from action_items table |
| `src/app/api/queues/support-action-board/complete-action/route.ts` | MODIFY | Write to action_items table |
| `src/components/dashboard/queues/support-action-board-view.tsx` | MODIFY | Lifecycle-aware action item rendering |
| `src/lib/events/event-router.ts` | MODIFY | Add auto-complete-check to agent_message events |
| `vercel.json` | MODIFY | Add staleness cron job |
