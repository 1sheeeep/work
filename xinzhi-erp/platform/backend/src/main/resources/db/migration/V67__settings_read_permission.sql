INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '67000000-0000-0000-0000-000000000001',
    'settings.read',
    'settings',
    '查看系统设置',
    '查看租户内任务公告、参数和系统设置入口'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'settings.read'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
