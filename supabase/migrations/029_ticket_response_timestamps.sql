-- Add communication timestamp columns for follow-up queue tracking
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_agent_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

-- Indexes for efficient querying of open tickets needing follow-up
CREATE INDEX IF NOT EXISTS idx_tickets_customer_msg ON support_tickets (last_customer_message_at) WHERE is_closed = FALSE;
CREATE INDEX IF NOT EXISTS idx_tickets_agent_msg ON support_tickets (last_agent_message_at) WHERE is_closed = FALSE;
