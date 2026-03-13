-- Demo Tracker: weekly counts of deals entering Demo Scheduled and Demo Completed stages

CREATE TABLE demo_tracker_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INT NOT NULL,
  fiscal_quarter INT NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  week_number INT NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  owner_id UUID REFERENCES owners(id),
  hubspot_owner_id TEXT,

  demos_scheduled INT NOT NULL DEFAULT 0,
  demos_completed INT NOT NULL DEFAULT 0,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fiscal_year, fiscal_quarter, week_number, owner_id)
);

-- Separate unique index for team total rows (owner_id IS NULL)
CREATE UNIQUE INDEX idx_demo_tracker_team_unique
  ON demo_tracker_snapshots (fiscal_year, fiscal_quarter, week_number)
  WHERE owner_id IS NULL;
