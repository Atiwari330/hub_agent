-- Phase 3: Webhook event logging for event-driven analysis triggers
-- Stores all inbound webhook events (HubSpot, Linear, internal) for debugging and replay

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                -- 'hubspot', 'linear', 'internal'
  event_type TEXT NOT NULL,            -- 'customer_message', 'ticket_created', etc.
  hubspot_ticket_id TEXT,              -- resolved ticket ID (may be NULL for unresolved events)
  raw_payload JSONB,                   -- original webhook payload
  passes_triggered TEXT[],             -- which analysis passes were dispatched
  processed_at TIMESTAMPTZ,            -- NULL until event is processed
  error TEXT,                          -- error message if processing failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_ticket ON webhook_events(hubspot_ticket_id);
CREATE INDEX idx_webhook_events_created ON webhook_events(created_at);
CREATE INDEX idx_webhook_events_unprocessed ON webhook_events(created_at) WHERE processed_at IS NULL;
