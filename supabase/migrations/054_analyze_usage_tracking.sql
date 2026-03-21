-- Usage tracking for per-ticket analysis
CREATE TABLE analysis_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  user_email text NOT NULL,
  user_display_name text,
  queue_type text NOT NULL CHECK (queue_type IN ('support-manager', 'support-trainer')),
  hubspot_ticket_id text NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_analysis_usage_log_user ON analysis_usage_log(user_id);
CREATE INDEX idx_analysis_usage_log_created ON analysis_usage_log(created_at DESC);

-- Grant analyze:ticket permission to all cs_manager users
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'analyze:ticket'
FROM user_profiles
WHERE role = 'cs_manager'
ON CONFLICT DO NOTHING;
