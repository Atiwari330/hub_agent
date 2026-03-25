# Phase 3: Event-Driven Analysis via Webhooks

## Goal

Replace the cron-based "analyze everything every 10 minutes" approach with **event-driven triggers** that run targeted analysis passes in response to specific ticket events. When a customer replies, the system re-analyzes within seconds — not after the next cron cycle.

## Why This Phase Depends on Phase 2

Event-driven triggers need to dispatch to **specific analysis passes**, not the full monolithic analysis. When a customer replies, we need to run situation + temperature + action items + response draft — but NOT verification or cross-ticket (those haven't changed). Phase 2's multi-pass architecture makes this selective triggering possible.

---

## Current State

**File:** `vercel.json` — Cron schedule

```json
{ "path": "/api/cron/analyze-support?mode=full", "schedule": "10 * * * *" }
```

Every 10 minutes during business hours, **every open ticket** gets fully re-analyzed across all three queues (trainer, manager, action board). This is:
- Wasteful: Most tickets haven't changed since last analysis
- Slow: Processing 30+ tickets * 3 queues * 500ms delay = ~45 seconds minimum
- Stale: A customer who replies at :11 waits until :20 for the next cycle

**No webhooks exist** in the codebase. No HubSpot webhook subscriptions. No Linear webhook handling.

---

## Target State

### Event Sources

| Source | Events | How |
|--------|--------|-----|
| **HubSpot** | Customer reply, agent response, ticket property change, ticket created, ticket closed | HubSpot Webhook Subscriptions API |
| **Linear** | Issue state change, comment added, assignee change | Linear Webhook |
| **Internal** | Action item completed, progress note added | Post-action hooks in existing routes |
| **Timer** | SLA threshold approaching | Lightweight cron check (no full analysis) |

### Event → Pass Mapping

| Event | Passes to Trigger | Latency Target |
|-------|-------------------|----------------|
| Customer sends message | situation, action_items, temperature, timing, response_draft | <10 seconds |
| Agent sends response | timing, verification, action_items | <10 seconds |
| Ticket created | ALL passes (full initial analysis) | <15 seconds |
| Ticket closed | situation (final summary) | <5 seconds |
| Ticket property change (priority, owner, etc.) | situation, action_items | <10 seconds |
| Linear issue state change | situation, action_items | <10 seconds |
| Linear comment added | situation, action_items | <10 seconds |
| Action item completed (internal) | verification | <5 seconds |
| Progress note added (internal) | none (just UI update via realtime) | N/A |
| SLA at 75% threshold | action_items (with urgency flag) | <5 seconds |
| New ticket from same company | cross_ticket (on ALL company tickets) | <15 seconds |

---

## Implementation Details

### Step 1: HubSpot Webhook Setup

HubSpot webhooks are configured via the App Developer account. The webhook subscription sends POST requests to your endpoint when specified events occur.

**HubSpot events to subscribe to:**

| Subscription Type | Property | Purpose |
|-------------------|----------|---------|
| `ticket.propertyChange` | `subject` | Ticket subject changed |
| `ticket.propertyChange` | `hs_pipeline_stage` | Ticket stage changed |
| `ticket.propertyChange` | `hubspot_owner_id` | Ticket reassigned |
| `ticket.propertyChange` | `hs_ticket_priority` | Priority changed |
| `ticket.creation` | — | New ticket created |
| `ticket.deletion` | — | Ticket deleted |
| `conversation.newMessage` | — | New message in conversation thread |

**Important:** HubSpot sends `conversation.newMessage` events for messages in conversation threads. This is the primary trigger for "customer replied" and "agent responded." The payload includes the message direction (INCOMING = customer, OUTGOING = agent).

**HubSpot webhook security:** HubSpot signs webhooks with a `X-HubSpot-Signature-v3` header. Verify this using your app's client secret + request body. See HubSpot docs for the signature algorithm.

### Step 2: Create Webhook Receiver Endpoint

**New file:** `src/app/api/webhooks/hubspot/route.ts`

```typescript
// POST /api/webhooks/hubspot
//
// 1. Verify HubSpot signature (X-HubSpot-Signature-v3)
// 2. Parse event payload (HubSpot sends arrays of events)
// 3. For each event:
//    a. Determine affected ticket ID
//    b. Map event type to analysis passes
//    c. Enqueue analysis job (don't block the webhook response)
// 4. Return 200 immediately (HubSpot retries on non-2xx)
//
// Key: Webhook handlers must respond quickly (<5 seconds).
// Analysis runs asynchronously via the event router.
```

**Event payload structure (HubSpot):**
```typescript
interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number; // epoch ms
  subscriptionType: string; // e.g., "ticket.propertyChange"
  attemptNumber: number;
  objectId: number; // ticket ID
  propertyName?: string;
  propertyValue?: string;
  changeSource?: string;
  sourceId?: string;
}
```

### Step 3: Create Linear Webhook Endpoint

**New file:** `src/app/api/webhooks/linear/route.ts`

```typescript
// POST /api/webhooks/linear
//
// Linear sends webhook events for issue updates.
// 1. Verify Linear webhook signature (using webhook secret)
// 2. Parse event (type: Issue, action: update/create)
// 3. Find ticket(s) linked to this Linear issue
//    - Query support_tickets WHERE linear_task = issue.identifier
// 4. Map event to analysis passes
// 5. Enqueue analysis
// 6. Return 200
```

**Linear webhook payload:**
```typescript
interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue' | 'Comment' | 'IssueLabel';
  data: {
    id: string;
    identifier: string; // e.g., "ENG-1234"
    title: string;
    state: { name: string };
    assignee?: { name: string };
    // ... other fields
  };
  updatedFrom?: {
    state?: { name: string };
    assignee?: { name: string };
  };
}
```

### Step 4: Create Event Router

**New file:** `src/lib/events/event-router.ts`

The event router is the central dispatching logic. It receives normalized events and determines which passes to run.

```typescript
export interface TicketEvent {
  source: 'hubspot' | 'linear' | 'internal';
  type: 'customer_message' | 'agent_message' | 'ticket_created' | 'ticket_closed'
    | 'property_change' | 'linear_state_change' | 'linear_comment'
    | 'action_completed' | 'sla_threshold';
  ticketId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Maps events to the passes that should run
const EVENT_PASS_MAP: Record<TicketEvent['type'], PassType[]> = {
  customer_message: ['situation', 'action_items', 'temperature', 'timing', 'response_draft'],
  agent_message: ['timing', 'verification', 'action_items'],
  ticket_created: ['situation', 'action_items', 'temperature', 'timing', 'cross_ticket', 'response_draft'],
  ticket_closed: ['situation'],
  property_change: ['situation', 'action_items'],
  linear_state_change: ['situation', 'action_items'],
  linear_comment: ['situation', 'action_items'],
  action_completed: ['verification'],
  sla_threshold: ['action_items'],
};

export async function routeEvent(event: TicketEvent): Promise<void> {
  const passes = EVENT_PASS_MAP[event.type];
  if (!passes || passes.length === 0) return;

  // Log the event for debugging/replay
  await logWebhookEvent(event);

  // Run the targeted passes via the orchestrator (from Phase 2)
  await runAnalysisPipeline(event.ticketId, { passes });
}
```

### Step 5: Add Webhook Event Logging

**New migration:** `supabase/migrations/XXX_webhook_events.sql`

```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,          -- 'hubspot', 'linear', 'internal'
  event_type TEXT NOT NULL,      -- 'customer_message', 'ticket_created', etc.
  hubspot_ticket_id TEXT,
  raw_payload JSONB,
  passes_triggered TEXT[],       -- which passes were dispatched
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_ticket ON webhook_events(hubspot_ticket_id);
CREATE INDEX idx_webhook_events_created ON webhook_events(created_at);

-- Cleanup: auto-delete events older than 30 days
-- (Can be a cron job or Supabase scheduled function)
```

### Step 6: Add Internal Event Hooks

Modify existing routes to emit internal events:

**Modified file:** `src/app/api/queues/support-action-board/complete-action/route.ts`

After successfully upserting the completion, emit an event:
```typescript
// After completion upsert succeeds:
await routeEvent({
  source: 'internal',
  type: 'action_completed',
  ticketId: body.ticketId,
  timestamp: new Date().toISOString(),
  metadata: { actionItemId: body.actionItemId },
});
```

### Step 7: Debouncing & Deduplication

HubSpot can send multiple events for a single action (e.g., property change fires for each changed property). The event router needs debouncing:

```typescript
// Debounce: If multiple events arrive for the same ticket within 5 seconds,
// merge them into a single analysis run with the union of all needed passes.
//
// Implementation: Use a simple in-memory map with a 5-second window.
// On first event for a ticket: start a 5-second timer.
// On subsequent events within the window: add their passes to the set.
// When timer fires: run the merged pass set.
//
// For Vercel (serverless): Use Vercel KV or a simple database-based queue
// since in-memory state doesn't persist across invocations.
```

**Alternative for Vercel serverless:** Instead of in-memory debouncing, use a lightweight queue:
1. Webhook writes event to `webhook_events` table with `processed_at = NULL`
2. A fast cron (every 1 minute) processes unprocessed events, grouping by ticket ID
3. This gives a natural 0-60 second debounce window

Or for truly real-time: Use Vercel's edge functions + KV store for the debounce window.

### Step 8: Reduce Cron Frequency

Once webhooks handle real-time events, the cron job shifts from "re-analyze everything" to "safety net":

**Modified:** `vercel.json`

```json
// Change from every-10-minute full analysis:
{ "path": "/api/cron/analyze-support?mode=full", "schedule": "10 * * * *" }

// To hourly safety net for anything webhooks missed:
{ "path": "/api/cron/analyze-support?mode=changed", "schedule": "0 * * * *" }
```

Add a new `mode=changed` to the cron that only re-analyzes tickets where the changed-detection logic (already in the GET route) identifies stale analyses.

### Step 9: Ticket Sync Optimization

Currently `sync-tickets` runs hourly. With webhooks providing real-time property updates, the sync becomes a safety net:

**Modified file:** `src/app/api/cron/sync-tickets/route.ts`

No code changes needed — the sync continues to run hourly as a consistency check. But the action board no longer depends on it for freshness since webhooks trigger analysis directly.

For ticket metadata updates (priority, owner, etc.), the webhook handler should also update the `support_tickets` table directly, so the data is immediately available for analysis passes:

```typescript
// In hubspot webhook handler, for property changes:
if (event.subscriptionType === 'ticket.propertyChange') {
  // Update the specific property in support_tickets
  await supabase.from('support_tickets')
    .update({ [mapProperty(event.propertyName)]: event.propertyValue })
    .eq('hubspot_ticket_id', String(event.objectId));
}
```

---

## Environment Variables

```env
# HubSpot Webhook
HUBSPOT_WEBHOOK_SECRET=       # App client secret for signature verification
HUBSPOT_APP_ID=               # Your HubSpot app ID

# Linear Webhook
LINEAR_WEBHOOK_SECRET=        # Linear webhook signing secret
```

---

## HubSpot Webhook Registration

Webhooks are registered via the HubSpot Developer Portal or API:

1. Go to your HubSpot App settings → Webhooks
2. Set the target URL to `https://your-domain.com/api/webhooks/hubspot`
3. Subscribe to:
   - `ticket.propertyChange` for properties: `subject`, `hs_pipeline_stage`, `hubspot_owner_id`, `hs_ticket_priority`
   - `ticket.creation`
   - `conversation.newMessage`
4. Set max concurrent requests to 10 (to avoid overwhelming your serverless functions)

## Linear Webhook Registration

1. Go to Linear Settings → API → Webhooks
2. Create a webhook pointing to `https://your-domain.com/api/webhooks/linear`
3. Subscribe to: Issue updates, Issue comments
4. Note the signing secret for verification

---

## Testing Plan

1. **Webhook signature verification**: Send a test webhook with invalid signature, verify it's rejected (401)
2. **Event routing**: Send a mock `customer_message` event, verify that situation + action_items + temperature + timing + response_draft passes are triggered
3. **End-to-end HubSpot**: Have a test customer reply on a real ticket. Verify the webhook fires, analysis runs, and the UI updates (via Phase 1 realtime) within 10 seconds
4. **Linear integration**: Change a Linear issue state. Verify the linked ticket's analysis updates
5. **Debouncing**: Send 5 events for the same ticket within 2 seconds. Verify only one analysis run fires (with the union of all needed passes)
6. **Webhook event logging**: Check the `webhook_events` table for a log of all received events
7. **Safety net cron**: Disable webhooks. Make a ticket change. Verify the hourly cron catches it
8. **Failure handling**: Simulate an analysis failure. Verify the webhook returns 200 (so HubSpot doesn't retry) and the error is logged

### Manual Testing Script

```bash
# Simulate a HubSpot webhook locally:
npx tsx src/scripts/test-webhook.ts --type customer_message --ticket <ticket_id>

# This script should:
# 1. Construct a mock HubSpot webhook payload
# 2. POST it to localhost:3000/api/webhooks/hubspot (skip signature verification in dev)
# 3. Print which passes were triggered
# 4. Wait for analysis to complete and print results
```

---

## Rollback Strategy

- Webhooks are additive — if they cause issues, simply remove the webhook subscriptions from HubSpot/Linear
- The cron job continues running as a safety net
- The event router is a new file — removing it doesn't affect existing code
- No existing endpoints are modified destructively

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/webhooks/hubspot/route.ts` | CREATE | HubSpot webhook receiver |
| `src/app/api/webhooks/linear/route.ts` | CREATE | Linear webhook receiver |
| `src/lib/events/event-router.ts` | CREATE | Event normalization + pass dispatching |
| `src/lib/events/debounce.ts` | CREATE | Event deduplication/merging logic |
| `supabase/migrations/XXX_webhook_events.sql` | CREATE | Webhook event logging table |
| `src/app/api/queues/support-action-board/complete-action/route.ts` | MODIFY | Emit internal event after completion |
| `vercel.json` | MODIFY | Reduce cron frequency |
| `src/app/api/cron/analyze-support/route.ts` | MODIFY | Add `mode=changed` for safety-net cron |
