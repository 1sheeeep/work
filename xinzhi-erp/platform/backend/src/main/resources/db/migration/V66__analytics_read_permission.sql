INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '66000000-0000-0000-0000-000000000001',
    'analytics.read',
    'analytics',
    '查看报表分析',
    '查看租户内销售、财务、商品与店铺报表入口'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'analytics.read'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
