-- Trainer collaboration: read confirmations, comments, inaccuracy reports

-- Table 1: Track which users have reviewed each ticket's training analysis
CREATE TABLE IF NOT EXISTS trainer_read_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_ticket_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hubspot_ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_reads_ticket ON trainer_read_confirmations(hubspot_ticket_id);
CREATE INDEX IF NOT EXISTS idx_trainer_reads_user ON trainer_read_confirmations(user_id);

-- Table 2: Comments and questions on ticket training analyses
CREATE TABLE IF NOT EXISTS trainer_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_ticket_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_comments_ticket ON trainer_comments(hubspot_ticket_id);

-- Table 3: Inaccuracy reports on AI-generated training analyses
CREATE TABLE IF NOT EXISTS trainer_inaccuracy_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_ticket_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_inaccuracy_ticket ON trainer_inaccuracy_reports(hubspot_ticket_id);

-- RLS policies
ALTER TABLE trainer_read_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_inaccuracy_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all collaboration data
CREATE POLICY "Authenticated users can view trainer reads"
  ON trainer_read_confirmations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can view trainer comments"
  ON trainer_comments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can view inaccuracy reports"
  ON trainer_inaccuracy_reports FOR SELECT USING (auth.uid() IS NOT NULL);

-- Service role manages all records
CREATE POLICY "Service role manages trainer reads"
  ON trainer_read_confirmations FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role manages trainer comments"
  ON trainer_comments FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role manages inaccuracy reports"
  ON trainer_inaccuracy_reports FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
