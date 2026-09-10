INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '64000000-0000-0000-0000-000000000001',
    'procurement.read',
    'procurement',
    '查看采购管理',
    '查看租户内采购计划、采购单、审核、到货与采购统计入口'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'procurement.read'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
