INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '63000000-0000-0000-0000-000000000001',
    'logistics.read',
    'logistics',
    '查看物流管理',
    '查看租户内物流授权、物流规则与物流数据入口'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'logistics.read'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
