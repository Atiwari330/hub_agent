-- Phase 6: Proactive Intelligence
-- Adds ticket_alerts, detected_patterns tables, and escalation_risk_score column

-- Alerts table: per-ticket alerts (escalation risk, SLA, stale, etc.)
CREATE TABLE IF NOT EXISTS ticket_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
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

-- Cross-ticket patterns (not per-ticket, global)
CREATE TABLE IF NOT EXISTS detected_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,      -- 'common_issue' | 'volume_spike' | 'company_cluster'
  description TEXT NOT NULL,
  affected_ticket_ids TEXT[] NOT NULL,
  recommended_action TEXT,
  confidence DECIMAL(4,2),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patterns_active ON detected_patterns(resolved) WHERE resolved = FALSE;

-- Escalation risk score on the ticket itself for quick access
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS escalation_risk_score DECIMAL(4,2);

-- Enable realtime for ticket_alerts so UI updates live
ALTER PUBLICATION supabase_realtime ADD TABLE ticket_alerts;
