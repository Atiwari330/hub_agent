-- Phase 4: Living Action Items
-- Moves action items from JSONB array in ticket_action_board_analyses
-- to their own table with full lifecycle tracking.

-- 1. Individual action items with lifecycle tracking
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT NOT NULL,
  hubspot_ticket_id TEXT NOT NULL REFERENCES support_tickets(hubspot_ticket_id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT 'any_support_agent',
  priority TEXT NOT NULL DEFAULT 'today',
  status TEXT NOT NULL DEFAULT 'active',
  status_tags TEXT[] DEFAULT '{}',

  -- Lifecycle metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_pass TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES user_profiles(id),
  completed_method TEXT,
  superseded_by TEXT,
  superseded_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  expired_reason TEXT,

  -- Verification
  verified BOOLEAN,
  verification_note TEXT,
  verified_at TIMESTAMPTZ,

  -- For ordering within a ticket
  sort_order INTEGER DEFAULT 0,

  PRIMARY KEY (id, hubspot_ticket_id)
);

CREATE INDEX idx_action_items_ticket ON action_items(hubspot_ticket_id, status);
CREATE INDEX idx_action_items_active ON action_items(hubspot_ticket_id) WHERE status = 'active';
CREATE INDEX idx_action_items_created ON action_items(created_at);

-- 2. Action item change log (for history)
CREATE TABLE IF NOT EXISTS action_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
  action_item_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_item_events_ticket ON action_item_events(hubspot_ticket_id);
CREATE INDEX idx_action_item_events_item ON action_item_events(action_item_id, hubspot_ticket_id);

-- 3. Migrate existing action items from analyses JSONB
INSERT INTO action_items (id, hubspot_ticket_id, description, who, priority, status, status_tags, created_at, created_by_pass, sort_order)
SELECT
  item->>'id',
  a.hubspot_ticket_id,
  item->>'description',
  COALESCE(item->>'who', 'any_support_agent'),
  COALESCE(item->>'priority', 'today'),
  'active',
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(item->'status_tags')),
    '{}'
  ),
  a.analyzed_at,
  'action_items',
  row_number() OVER (PARTITION BY a.hubspot_ticket_id ORDER BY (item->>'id'))::int
FROM ticket_action_board_analyses a,
     jsonb_array_elements(a.action_items) AS item
WHERE a.action_items IS NOT NULL
  AND jsonb_array_length(a.action_items) > 0
ON CONFLICT DO NOTHING;

-- 4. Migrate existing completions to update the new table
UPDATE action_items ai
SET
  status = 'completed',
  completed_at = c.completed_at,
  completed_by = c.completed_by,
  completed_method = 'manual',
  verified = c.verified,
  verification_note = c.verification_note
FROM action_item_completions c
WHERE ai.id = c.action_item_id
  AND ai.hubspot_ticket_id = c.hubspot_ticket_id;

-- 5. Enable realtime on the new table
ALTER PUBLICATION supabase_realtime ADD TABLE action_items;
