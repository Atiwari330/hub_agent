INSERT INTO user_permissions (user_id, resource)
SELECT id, 'hot_tracker' FROM user_profiles
WHERE email IN ('eric@opusbehavioral.com', 'hbuniotto@opusbehavioral.com')
ON CONFLICT (user_id, resource) DO NOTHING;
