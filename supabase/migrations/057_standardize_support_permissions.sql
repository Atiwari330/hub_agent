-- Standardize permissions for support_agent and cs_manager roles
-- support_agent: support-trainer + action-board (no analyze)
-- cs_manager: support-manager + support-trainer + action-board + analyze:ticket

-- Grant support_agent users their full set of permissions
INSERT INTO user_permissions (id, user_id, resource)
SELECT gen_random_uuid(), up.id, perm.resource
FROM user_profiles up
CROSS JOIN (
  VALUES ('queue:support-trainer'), ('queue:support-action-board')
) AS perm(resource)
WHERE up.role = 'support_agent'
ON CONFLICT (user_id, resource) DO NOTHING;

-- Grant cs_manager users their full set of permissions
INSERT INTO user_permissions (id, user_id, resource)
SELECT gen_random_uuid(), up.id, perm.resource
FROM user_profiles up
CROSS JOIN (
  VALUES ('queue:support-manager'), ('queue:support-trainer'), ('queue:support-action-board'), ('analyze:ticket')
) AS perm(resource)
WHERE up.role = 'cs_manager'
ON CONFLICT (user_id, resource) DO NOTHING;
