-- CS Manager role, voice memos, and ticket status tracking

-- 1. Update role constraint to allow cs_manager
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('vp_revops', 'cmo', 'ceo', 'account_executive', 'cs_manager'));

-- 2. Voice memos table (one per ticket, recorded by VP RevOps)
CREATE TABLE IF NOT EXISTS ticket_voice_memos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_ticket_id TEXT NOT NULL,
  recorded_by UUID NOT NULL REFERENCES user_profiles(id),
  storage_path TEXT NOT NULL,
  duration_seconds INT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hubspot_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_memos_ticket ON ticket_voice_memos(hubspot_ticket_id);

-- 3. CS Manager ticket status tracking
CREATE TABLE IF NOT EXISTS ticket_cs_statuses (
  hubspot_ticket_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('acknowledged', 'in_progress', 'done', 'blocked')),
  updated_by UUID NOT NULL REFERENCES user_profiles(id),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cs_statuses_status ON ticket_cs_statuses(status);

-- 4. RLS policies
ALTER TABLE ticket_voice_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_cs_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view voice memos"
  ON ticket_voice_memos FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages voice memos"
  ON ticket_voice_memos FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Authenticated users can view cs statuses"
  ON ticket_cs_statuses FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages cs statuses"
  ON ticket_cs_statuses FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
