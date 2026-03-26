-- Morning Briefing tables for automated CRO daily intelligence
-- Stores results from ticket-triage, deal-scrub, and ppl-cadence runs

CREATE TABLE morning_briefing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  github_run_id VARCHAR(100),
  sync_status VARCHAR(30) DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'sync_failed_used_cache', 'skipped')),
  sync_completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_briefing_runs_date ON morning_briefing_runs(run_date);
CREATE INDEX idx_briefing_runs_status ON morning_briefing_runs(status);

CREATE TABLE morning_briefing_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES morning_briefing_runs(id) ON DELETE CASCADE,
  section_type VARCHAR(50) NOT NULL
    CHECK (section_type IN ('ticket_triage', 'deal_scrub', 'ppl_cadence')),
  owner_email VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  results_json JSONB,
  results_markdown TEXT,
  summary_json JSONB,
  item_count INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_briefing_sections_run ON morning_briefing_sections(run_id);
CREATE INDEX idx_briefing_sections_type ON morning_briefing_sections(section_type);
