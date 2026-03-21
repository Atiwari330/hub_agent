-- Grant dashboard access permissions to all account_executive users
-- This enables: dashboard shell access, AE home page, and read-only enrichment views

INSERT INTO user_permissions (user_id, resource)
SELECT up.id, perm.resource
FROM user_profiles up
CROSS JOIN (
  VALUES ('dashboard'), ('ae_home'), ('queue:enrichment-view')
) AS perm(resource)
WHERE up.role = 'account_executive'
ON CONFLICT DO NOTHING;
