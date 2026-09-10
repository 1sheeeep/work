INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '65000000-0000-0000-0000-000000000001',
    'finance.read',
    'finance',
    '查看财务管理',
    '查看租户内银行账号、收付款单与财务统计入口'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'finance.read'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
