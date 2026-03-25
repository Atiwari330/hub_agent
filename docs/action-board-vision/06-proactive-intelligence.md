# Phase 6: Proactive Intelligence

## Goal

Transform the action board from a reactive dashboard ("here's what you should do about tickets that already need attention") into a **proactive system** that predicts problems, detects patterns, and pushes alerts before agents even look at the board. The system becomes a teammate that watches everything and taps you on the shoulder when something matters.

## Why This Phase Depends on 1, 2, and 3

- **Phase 1 (Realtime UI)**: Alerts need to appear in the UI immediately, not on next refresh
- **Phase 2 (Multi-Pass)**: Proactive checks are lightweight specialized passes, not full analyses
- **Phase 3 (Event-Driven)**: Event data feeds the pattern detection engine

---

## Proactive Intelligence Capabilities

### 1. Escalation Prediction

**What it does:** Monitors ticket signals and predicts which tickets are likely to escalate in the next 1-2 interactions.

**Signals analyzed:**
- Customer tone trend across messages (getting shorter? More direct? ALL CAPS?)
- Response time trend (are they emailing more frequently?)
- Number of back-and-forth messages without resolution
- Time since ticket opened relative to complexity
- Customer tier (VIP/Co-Destiny gets tighter thresholds)
- Historical patterns: "Tickets that look like this escalated 70% of the time"

**Output:** `escalation_risk_score` (0.00-1.00) + `escalation_risk_reason` per ticket

**Trigger:** Runs after every temperature pass (Phase 2). Also runs on a 30-minute background check for tickets that haven't had recent events.

**UI display:** A subtle risk indicator next to the temperature badge. High-risk tickets (>0.75) get a visual warning: "Escalation risk: High — customer tone has shifted negative across last 3 messages."

### 2. SLA Risk Monitoring

**What it does:** Tracks SLA timers and pushes alerts at configurable thresholds before breach.

**Thresholds:**
- 50% of SLA elapsed → "SLA Watch" (informational)
- 75% of SLA elapsed → "SLA Warning" (action needed)
- 90% of SLA elapsed → "SLA Critical" (immediate action)
- 100% → "SLA Breached"

**SLA rules (Opus-specific):**
- First response time: 4 business hours for standard, 1 hour for VIP
- Next response time: 8 business hours for standard, 4 hours for VIP
- Resolution target: Varies by priority

**Important:** SLA calculations must respect business hours (9 AM - 7 PM ET, Mon-Fri), consistent with the existing `isBusinessHours()` utility in `src/lib/utils/business-hours.ts`.

**Trigger:** Lightweight cron every 5 minutes (no LLM needed — pure timestamp math).

**Action:** When SLA is at 75%+, automatically elevate priority on the ticket's action items to "now" and generate a specific action item: "SLA at [X]% — respond to customer within [remaining time]. Draft response available below."

### 3. Cross-Ticket Pattern Detection

**What it does:** Identifies when multiple tickets share a common root cause — suggesting a product issue rather than individual support issues.

**Patterns detected:**
- Multiple tickets mentioning the same keyword/feature in a time window
- Multiple tickets from the same software module (Copilot, RCM, Scheduling)
- Spike in ticket creation rate (e.g., 5+ tickets in 1 hour when average is 1/hour)
- Multiple tickets from the same company with related issues

**Trigger:** Runs every 2 hours as a batch analysis across all open tickets. Also triggered when a new ticket arrives that matches an existing pattern.

**Output:** Pattern alerts with:
- Pattern description ("5 tickets in the last 24 hours mention 'sync error after March update'")
- Affected ticket IDs
- Recommended action ("Consider escalating to engineering as a potential product bug")
- Confidence score

**UI display:** A "Patterns" banner at the top of the action board showing active patterns. Clicking shows affected tickets grouped together.

### 4. Agent Workload Awareness

**What it does:** Monitors ticket distribution across agents and surfaces imbalances.

**Checks:**
- Total active tickets per assigned rep
- Number of "reply_needed" tickets per rep
- Average response wait time across a rep's tickets
- Tickets with no assigned rep

**Trigger:** Runs every 30 minutes. No LLM needed — pure database queries.

**Output:** Workload summary:
- "[Rep A] has 12 active tickets, 6 needing replies (avg wait: 3.2h)"
- "[Rep B] has 3 active tickets, 0 needing replies"
- "3 tickets are unassigned"

**UI display:** Visible to CS Manager and VP RevOps. Shows as a collapsible "Team Workload" section.

### 5. Resolution Path Suggestion

**What it does:** Based on ticket characteristics, suggests the most likely resolution path based on historical patterns.

**Analysis:**
- "Tickets about [software] + [category] + [symptom] have been resolved by:"
  - 60% → Configuration change (avg 2 days)
  - 25% → Engineering fix (avg 5 days)
  - 15% → Customer training (avg 1 day)

**Trigger:** Runs once when a ticket is first analyzed. Re-runs if the ticket's category or classification changes.

**How it works:** This requires a training corpus. The system looks at recently closed tickets (last 90 days) with similar characteristics and analyzes what resolved them.

**Output:** Suggested resolution path with confidence and average time-to-resolve.

### 6. Stale Ticket Alerting

**What it does:** Identifies tickets that have gone quiet — no activity from anyone in X days.

**Thresholds:**
- 2 business days with no activity → "Going Stale" warning
- 5 business days → "Stale" alert with action item to check in
- 10 business days → "Critical Stale" escalated to CS Manager

**Trigger:** Daily check (morning, 9 AM ET). No LLM needed.

---

## Implementation Details

### Step 1: Alerts Table

**New migration:** `supabase/migrations/XXX_ticket_alerts.sql`

```sql
CREATE TABLE IF NOT EXISTS ticket_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT REFERENCES support_tickets(hubspot_ticket_id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,        -- 'escalation_risk' | 'sla_warning' | 'pattern' | 'workload' | 'stale'
  severity TEXT NOT NULL,          -- 'info' | 'warning' | 'critical'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',     -- type-specific data (risk score, SLA %, pattern tickets, etc.)
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,         -- auto-resolved when condition clears
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ           -- auto-expire old alerts
);

CREATE INDEX idx_ticket_alerts_ticket ON ticket_alerts(hubspot_ticket_id);
CREATE INDEX idx_ticket_alerts_type ON ticket_alerts(alert_type, severity);
CREATE INDEX idx_ticket_alerts_active ON ticket_alerts(resolved_at) WHERE resolved_at IS NULL;

-- Escalation risk score on the ticket itself for quick access
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS escalation_risk_score DECIMAL(4,2);

-- Cross-ticket patterns (not per-ticket, global)
CREATE TABLE IF NOT EXISTS detected_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,      -- 'common_issue' | 'volume_spike' | 'company_cluster'
  description TEXT NOT NULL,
  affected_ticket_ids TEXT[] NOT NULL,
  recommended_action TEXT,
  confidence DECIMAL(4,2),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patterns_active ON detected_patterns(resolved) WHERE resolved = FALSE;
```

### Step 2: Escalation Prediction

**New file:** `src/lib/ai/intelligence/escalation-predictor.ts`

```typescript
// Runs after every temperature pass for a ticket
// Also runs on 30-minute background sweep
//
// Two-stage approach:
//
// Stage 1 (no LLM): Score based on signals
//   - hours_since_customer_waiting: +0.1 per hour over 2
//   - temperature == 'escalating': +0.3
//   - temperature == 'angry': +0.5
//   - message_count > 6 without resolution: +0.2
//   - is_co_destiny: +0.15 (lower threshold for VIP)
//   - decreasing message length trend: +0.1
//   - increasing message frequency: +0.1
//
// Stage 2 (LLM, only if Stage 1 score > 0.5):
//   Quick focused check on conversation tone trend
//   "Is this customer's tone getting worse? What's the trajectory?"
//
// Output: escalation_risk_score + reason
// Writes to: support_tickets.escalation_risk_score + ticket_alerts if score > threshold
```

### Step 3: SLA Monitor

**New file:** `src/lib/ai/intelligence/sla-monitor.ts`

```typescript
// Pure computation — no LLM needed
// Runs every 5 minutes via cron
//
// For each open ticket:
// 1. Determine SLA tier (VIP vs standard)
// 2. Calculate elapsed business hours since last customer message
// 3. Check against SLA thresholds
// 4. Create/update/resolve alerts as thresholds are crossed
//
// Uses isBusinessHours() from src/lib/utils/business-hours.ts
// Business hours: 9 AM - 7 PM ET, Mon-Fri
```

**New cron endpoint:** `src/app/api/cron/sla-monitor/route.ts`
- Schedule: `*/5 * * * *` (every 5 minutes)
- Only runs during business hours

### Step 4: Cross-Ticket Pattern Detector

**New file:** `src/lib/ai/intelligence/pattern-detector.ts`

```typescript
// Runs every 2 hours
// Also triggered when new tickets arrive
//
// Step 1: Aggregate ticket data
//   - Group open tickets by: software, category, keywords
//   - Count tickets created in rolling time windows (1h, 4h, 24h)
//
// Step 2: Detect anomalies (no LLM)
//   - Volume spike: >3x normal rate in a time window
//   - Keyword clustering: 3+ tickets with same keyword in 24h
//   - Company clustering: 3+ open tickets from same company
//
// Step 3: Analyze patterns (LLM)
//   For each detected cluster:
//   "These N tickets all mention [keyword/feature]. Is this likely a product issue?
//    Tickets: [list with subjects and summaries]
//    Recommend: Is this worth escalating to engineering as a potential bug?"
//
// Step 4: Create pattern alerts
//   Write to detected_patterns table
//   Create ticket_alerts for each affected ticket
```

### Step 5: Stale Ticket Check

**New file:** `src/lib/ai/intelligence/stale-checker.ts`

```typescript
// Pure database query — no LLM
// Runs daily at 9 AM ET
//
// Query: open tickets WHERE last activity > X business days ago
// Tiers:
//   2 business days → severity: 'info', "Going stale — consider checking in"
//   5 business days → severity: 'warning', "Stale — no activity in 5 days"
//   10 business days → severity: 'critical', "Critical stale — escalate to CS Manager"
//
// Creates ticket_alerts and generates an action item (Phase 4) for stale tickets
```

### Step 6: Alert UI Integration

**Modified file:** `src/components/dashboard/queues/support-action-board-view.tsx`

Add alerts to the action board UI:

1. **Global alerts banner** (top of board):
   - Pattern alerts: "3 tickets this week mention 'sync error' — possible product issue"
   - Workload alerts: "Agent A has 6 tickets needing replies"

2. **Per-ticket alert indicators**:
   - Escalation risk badge next to temperature
   - SLA countdown timer (live-updating via Phase 1)
   - Stale indicator

3. **Alert acknowledgment**: Agents can acknowledge alerts (dismisses for them, but stays for others)

### Step 7: Alert Lifecycle

Alerts auto-resolve when their condition clears:
- Escalation risk alert resolves when risk score drops below threshold
- SLA alert resolves when agent responds
- Stale alert resolves when activity occurs
- Pattern alert resolves manually (CS Manager marks resolved)

**Modified file:** `src/lib/events/event-router.ts`

After event processing, check if any alerts should be resolved:
```typescript
// After running analysis passes for an event:
await resolveAlertsForTicket(ticketId, event.type);
// e.g., agent_message event → resolve SLA alerts, stale alerts
```

---

## Cron Schedule Summary

| Endpoint | Schedule | Purpose | LLM? |
|----------|----------|---------|------|
| `/api/cron/sla-monitor` | `*/5 * * * *` | SLA threshold checks | No |
| `/api/cron/escalation-sweep` | `*/30 * * * *` | Background escalation risk scoring | Sometimes |
| `/api/cron/pattern-detector` | `0 */2 * * *` | Cross-ticket pattern analysis | Yes |
| `/api/cron/stale-checker` | `0 13 * * 1-5` | Morning stale ticket check (9 AM ET) | No |
| `/api/cron/action-item-staleness` | `*/15 * * * *` | From Phase 4 | Sometimes |

All cron jobs respect business hours via `isBusinessHours()`.

---

## Testing Plan

1. **Escalation prediction**: Find a ticket with an angry customer. Verify escalation risk score is high. Find a calm ticket. Verify score is low.
2. **SLA monitoring**: Create a test scenario where a customer message is 3 hours old (standard SLA = 4h). Verify the 75% SLA warning fires. Respond to the customer. Verify the alert resolves.
3. **Pattern detection**: Create 3 test tickets with "sync error" in the subject. Run the pattern detector. Verify a pattern is identified.
4. **Stale tickets**: Find a ticket with no activity in 3+ days. Run the stale checker. Verify an alert is created.
5. **Alert UI**: Verify alerts appear in the action board UI — both global banner and per-ticket indicators
6. **Alert resolution**: Trigger an SLA alert, then respond to the customer. Verify the alert auto-resolves.
7. **Alert acknowledgment**: Acknowledge an alert as one user. Verify it's still visible to other users.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/XXX_ticket_alerts.sql` | CREATE | Alerts + patterns tables, escalation risk column |
| `src/lib/ai/intelligence/escalation-predictor.ts` | CREATE | Escalation risk scoring |
| `src/lib/ai/intelligence/sla-monitor.ts` | CREATE | SLA threshold monitoring |
| `src/lib/ai/intelligence/pattern-detector.ts` | CREATE | Cross-ticket pattern detection |
| `src/lib/ai/intelligence/stale-checker.ts` | CREATE | Stale ticket identification |
| `src/app/api/cron/sla-monitor/route.ts` | CREATE | SLA cron endpoint |
| `src/app/api/cron/escalation-sweep/route.ts` | CREATE | Escalation cron endpoint |
| `src/app/api/cron/pattern-detector/route.ts` | CREATE | Pattern detection cron endpoint |
| `src/app/api/cron/stale-checker/route.ts` | CREATE | Stale ticket cron endpoint |
| `src/components/dashboard/queues/support-action-board-view.tsx` | MODIFY | Add alert UI (banner, per-ticket indicators, acknowledgment) |
| `src/app/api/queues/support-action-board/route.ts` | MODIFY | Include alerts in response |
| `src/lib/events/event-router.ts` | MODIFY | Add alert resolution after events |
| `vercel.json` | MODIFY | Add new cron schedules |
