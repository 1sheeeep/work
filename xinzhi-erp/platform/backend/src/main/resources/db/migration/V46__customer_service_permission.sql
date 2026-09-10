-- Customer-service permission catalog and existing tenant-admin upgrade.
INSERT INTO permissions (id, code, module, name, description)
VALUES
    (
        'c4800000-0000-0000-0000-000000000001',
        'customer_service.read',
        'customer_service',
        'Read customer service workbench',
        'Enter the tenant customer service workbench and read assigned customer context'
    ),
    (
        'c4800000-0000-0000-0000-000000000002',
        'customer_service.conversation.claim',
        'customer_service',
        'Claim customer conversations',
        'Claim an available tenant customer conversation'
    ),
    (
        'c4800000-0000-0000-0000-000000000003',
        'customer_service.conversation.reply',
        'customer_service',
        'Reply to customer conversations',
        'Send replies in an assigned tenant customer conversation'
    ),
    (
        'c4800000-0000-0000-0000-000000000004',
        'customer_service.conversation.transfer',
        'customer_service',
        'Transfer customer conversations',
        'Transfer an assigned tenant customer conversation'
    ),
    (
        'c4800000-0000-0000-0000-000000000005',
        'customer_service.conversation.close',
        'customer_service',
        'Close customer conversations',
        'Close or reopen an assigned tenant customer conversation'
    ),
    (
        'c4800000-0000-0000-0000-000000000006',
        'customer_service.ticket.manage',
        'customer_service',
        'Manage customer service tickets',
        'Create and update tenant customer service tickets'
    )
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- Upgrade existing tenants as well as future bootstrap tenants. The protected
-- system role cannot be repaired through the ordinary role editor, so the
-- migration grants the complete workbench capability set idempotently.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
  AND permission.code IN (
      'customer_service.read',
      'customer_service.conversation.claim',
      'customer_service.conversation.reply',
      'customer_service.conversation.transfer',
      'customer_service.conversation.close',
      'customer_service.ticket.manage'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
