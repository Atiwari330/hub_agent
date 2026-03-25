# Phase 1: Real-Time UI Foundation — COMPLETE

> **Status:** Implemented and deployed on `feature/realtime-action-board`. Migration `060_enable_realtime.sql` must be run on Supabase. No deviations from plan.

## Goal

Replace the manual-refresh, fetch-once-on-load UI with a live-updating action board that reflects ticket and analysis changes in real time. When an analysis completes, a customer replies, or an action item is marked complete — the UI updates automatically without anyone clicking refresh.

## Why This Phase Is First

Every subsequent phase generates more data, more frequently. If the UI can't display changes in real time, all that work is invisible until someone clicks refresh. Building the realtime foundation first means that Phases 2-7 are immediately visible the moment they're deployed.

---

## Current State

**File:** `src/components/dashboard/queues/support-action-board-view.tsx`

- UI fetches all data once via `fetchData()` in a `useEffect` on mount
- Manual refresh button triggers `fetchData()` again
- After actions (analyze, complete, note), `fetchData()` is called to refetch everything
- No Supabase Realtime subscriptions anywhere in the codebase
- No polling, no WebSockets, no Server-Sent Events for live data (SSE is only used during batch analysis progress)

**Data staleness:** Whatever you see on screen is frozen from the moment you loaded the page or last clicked refresh.

---

## Target State

1. **Supabase Realtime subscriptions** on key tables:
   - `ticket_action_board_analyses` — when any analysis is created or updated, the affected ticket row updates live
   - `action_item_completions` — when someone completes an action, it reflects immediately for all viewers
   - `progress_notes` — when someone adds a note, it appears for everyone
   - `support_tickets` — when ticket metadata changes (via sync), the row updates

2. **Granular UI updates** — only the affected ticket row re-renders, not the entire list

3. **Live timing recalculation** — `hours_since_customer_waiting` and other timing fields tick forward in real time on the client, not just at analysis time

4. **Connection status indicator** — small indicator showing whether realtime connection is active

---

## Implementation Details

### Step 1: Supabase Realtime Client Setup

Create a reusable realtime hook:

**New file:** `src/hooks/use-realtime-subscription.ts`

```typescript
// Hook that subscribes to Supabase Realtime changes on a table
// Returns: subscribe/unsubscribe lifecycle tied to component mount
// Uses the browser Supabase client from src/lib/supabase/client.ts (createClient)
//
// Key design decisions:
// - Subscribe to specific tables with filters (e.g., only open tickets)
// - Handle INSERT, UPDATE, DELETE events
// - Provide a callback with the changed row and event type
// - Auto-reconnect on connection loss
// - Expose connection status (connected, connecting, disconnected)
```

### Step 2: Enable Realtime on Tables

Supabase Realtime requires tables to have replication enabled. This needs a migration:

**New migration:** `supabase/migrations/XXX_enable_realtime.sql`

```sql
-- Enable realtime for action board tables
ALTER PUBLICATION supabase_realtime ADD TABLE ticket_action_board_analyses;
ALTER PUBLICATION supabase_realtime ADD TABLE action_item_completions;
ALTER PUBLICATION supabase_realtime ADD TABLE progress_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE support_tickets;
```

**Important:** Supabase Realtime respects Row Level Security (RLS). The browser client's subscriptions will only receive rows the user has access to. Verify that RLS policies on these tables allow SELECT for authenticated users who have action board access.

### Step 3: Integrate Realtime into Action Board View

**Modified file:** `src/components/dashboard/queues/support-action-board-view.tsx`

Current pattern (fetch everything, replace state):
```typescript
const fetchData = useCallback(async () => {
  const response = await fetch('/api/queues/support-action-board');
  const data = await response.json();
  setTickets(data.tickets);
  // ... set counts, etc.
}, []);

useEffect(() => { fetchData(); }, [fetchData]);
```

New pattern (initial fetch + realtime updates):
```typescript
// Initial fetch stays the same — full data load on mount
useEffect(() => { fetchData(); }, [fetchData]);

// Realtime subscriptions for incremental updates
useEffect(() => {
  const channel = supabase.channel('action-board-live')
    // Analysis changes
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'ticket_action_board_analyses',
    }, (payload) => {
      // Update the specific ticket's analysis in state
      // Don't refetch everything — just merge the changed analysis
    })
    // Completion changes
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'action_item_completions',
    }, (payload) => {
      // Add completion to the specific ticket's completions array
    })
    // Progress note changes
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'progress_notes',
    }, (payload) => {
      // Update the specific ticket's notes
    })
    // Ticket metadata changes
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'support_tickets',
      filter: 'is_closed=eq.false',
    }, (payload) => {
      // Update ticket metadata (company, priority, owner, etc.)
    })
    .subscribe((status) => {
      setRealtimeConnected(status === 'SUBSCRIBED');
    });

  return () => { supabase.removeChannel(channel); };
}, [supabase]);
```

**Key design point:** Realtime payloads include the full new row. For `ticket_action_board_analyses`, this means the full analysis object. The handler should find the matching ticket in state and update just its `analysis` field — no need to refetch the entire board.

### Step 4: Live Timing Recalculation

Currently, `hours_since_customer_waiting` is a static number from analysis time. Add a client-side timer:

```typescript
// Every 60 seconds, recalculate display times based on analysis timestamps
// This doesn't change the stored values — just the displayed values
useEffect(() => {
  const interval = setInterval(() => {
    setTickets(prev => prev.map(ticket => {
      if (!ticket.analysis) return ticket;
      // Recalculate hours_since_customer_waiting based on:
      // - The ticket's last_customer_message_at
      // - The ticket's last_agent_message_at
      // - Current time
      // This is pure client-side math, no API call
      return { ...ticket }; // trigger re-render
    }));
  }, 60_000);
  return () => clearInterval(interval);
}, []);
```

**Important:** The underlying ticket timestamps (`last_customer_message_at`, `last_agent_message_at`) need to be included in the data sent to the UI. Currently the GET route sends these embedded in the analysis, but the raw ticket timestamps would be more accurate. Consider adding `lastCustomerMessageAt` and `lastAgentMessageAt` to the `ActionBoardTicket` interface.

### Step 5: Connection Status Indicator

Add a small dot in the header area:

- Green dot + "Live" when realtime is connected
- Yellow dot + "Connecting..." during connection
- Red dot + "Offline" when disconnected (with auto-retry)

This gives agents confidence that what they're seeing is current.

### Step 6: Optimistic UI for Actions

When an agent completes an action item or submits a progress note, update the UI **immediately** (optimistically) before the API call returns. If the API call fails, revert. This makes the UI feel instant.

Current flow:
```
Click complete → API call → wait for response → fetchData() → UI updates
```

New flow:
```
Click complete → UI updates immediately → API call in background →
  if fails: revert UI + show error toast
  if succeeds: realtime subscription confirms (no-op since already updated)
```

---

## Testing Plan

1. **Realtime connection**: Open the action board, verify the green "Live" indicator appears
2. **Analysis updates**: Trigger a single ticket re-analysis from one browser tab. In another tab (or same tab without refresh), verify the analysis updates automatically
3. **Action completion**: Complete an action item. Verify it shows as completed immediately. Open a second browser tab and verify the completion appears there without refresh
4. **Progress notes**: Submit a progress note. Verify it appears for another user viewing the same board
5. **Timing accuracy**: Note a ticket's wait time. Wait 2 minutes. Verify the displayed wait time has advanced without refresh
6. **Connection recovery**: Disconnect network briefly (or stop Supabase). Verify the indicator turns red. Reconnect and verify it recovers and data syncs
7. **Performance**: With ~50 open tickets, verify that realtime updates don't cause the entire list to re-render (use React DevTools profiler)

---

## Rollback Strategy

The realtime subscriptions are purely additive. The manual refresh button and `fetchData()` pattern remain intact. If realtime causes issues:
- Remove the `useEffect` with channel subscriptions
- The board works exactly as before (manual refresh)

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/use-realtime-subscription.ts` | CREATE | Reusable Supabase Realtime hook |
| `supabase/migrations/XXX_enable_realtime.sql` | CREATE | Enable realtime on 4 tables |
| `src/components/dashboard/queues/support-action-board-view.tsx` | MODIFY | Add realtime subscriptions, live timing, connection indicator, optimistic updates |
| `src/app/api/queues/support-action-board/route.ts` | MODIFY | Include raw ticket timestamps in response for client-side timing |
