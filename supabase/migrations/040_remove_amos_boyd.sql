-- Remove Amos Boyd (aboyd@opusbehavioral.com) from application
-- Historical deal data is preserved; only future quotas/targets and auth records are removed.

-- Delete future quotas (Q2 2026+)
DELETE FROM quotas
WHERE owner_email = 'aboyd@opusbehavioral.com'
  AND quarter >= 'Q2 2026';

-- Delete ae_targets for future quarters
DELETE FROM ae_targets
WHERE owner_id IN (
  SELECT hubspot_owner_id FROM owners WHERE email = 'aboyd@opusbehavioral.com'
)
AND quarter >= 'Q2 2026';

-- Remove user_permissions for aboyd
DELETE FROM user_permissions
WHERE user_id IN (
  SELECT id FROM user_profiles WHERE email = 'aboyd@opusbehavioral.com'
);

-- Remove user_profiles for aboyd
DELETE FROM user_profiles
WHERE email = 'aboyd@opusbehavioral.com';
