-- Hot Tracker: new deal columns and pre-computed metrics snapshot table

-- New deal columns for proposal stage tracking and gift/incentive flag
ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_entered_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS sent_gift_or_incentive BOOLEAN DEFAULT FALSE;

-- Pre-computed weekly hot tracker metrics
CREATE TABLE hot_tracker_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INT NOT NULL,
  fiscal_quarter INT NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  week_number INT NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  owner_id UUID REFERENCES owners(id),  -- NULL = team total
  hubspot_owner_id TEXT,

  -- Metric 1: % SQLs contacted within 15 min
  sql_deals_count INT NOT NULL DEFAULT 0,
  sql_contacted_15min INT NOT NULL DEFAULT 0,
  sql_deal_details JSONB,

  -- Metric 2: Calls to SQLs with phone
  calls_to_sql_with_phone INT NOT NULL DEFAULT 0,

  -- Metric 3: Proposal deals with gift
  proposal_deals_count INT NOT NULL DEFAULT 0,
  proposal_deals_with_gift INT NOT NULL DEFAULT 0,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fiscal_year, fiscal_quarter, week_number, owner_id)
);

-- Unique index for team total rows (where owner_id IS NULL)
CREATE UNIQUE INDEX idx_hot_tracker_team_unique
  ON hot_tracker_snapshots (fiscal_year, fiscal_quarter, week_number)
  WHERE owner_id IS NULL;
