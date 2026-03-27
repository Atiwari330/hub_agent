-- Grant PPL Dashboard access to CMO and CEO users
INSERT INTO user_permissions (user_id, resource)
SELECT id, 'ppl_dashboard' FROM user_profiles
WHERE role IN ('cmo', 'ceo')
ON CONFLICT (user_id, resource) DO NOTHING;
