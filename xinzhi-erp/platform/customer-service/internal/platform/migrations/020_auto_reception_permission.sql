UPDATE users
SET permissions = permissions || '["routing.auto_receive"]'::jsonb
WHERE role = 'agent'
  AND permissions_customized = TRUE
  AND permissions ? 'workbench.access'
  AND NOT permissions ? 'routing.auto_receive';
