-- Tenant-owned warehouse data scopes. Feature permissions remain independent:
-- callers must pass the feature-permission gate before this scope is evaluated.
CREATE TABLE tenant_user_warehouse_scopes (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    mode VARCHAR(16) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT fk_tenant_user_warehouse_scopes_user
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_user_warehouse_scopes_mode
        CHECK (mode IN ('ALL', 'SELECTED')),
    CONSTRAINT ck_tenant_user_warehouse_scopes_version
        CHECK (version >= 0)
);

CREATE TABLE tenant_user_warehouse_scope_items (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, warehouse_id),
    CONSTRAINT fk_tenant_user_warehouse_scope_items_scope
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES tenant_user_warehouse_scopes (tenant_id, user_id),
    CONSTRAINT fk_tenant_user_warehouse_scope_items_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id)
);

CREATE INDEX idx_tenant_user_warehouse_scope_items_warehouse
    ON tenant_user_warehouse_scope_items (tenant_id, warehouse_id, user_id);

CREATE FUNCTION enforce_selected_warehouse_scope_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM tenant_user_warehouse_scopes scope
        WHERE scope.tenant_id = NEW.tenant_id
          AND scope.user_id = NEW.user_id
          AND scope.mode = 'SELECTED'
    ) THEN
        RAISE EXCEPTION 'warehouse scope items require SELECTED mode'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_warehouse_scope_items_selected
BEFORE INSERT OR UPDATE ON tenant_user_warehouse_scope_items
FOR EACH ROW EXECUTE FUNCTION enforce_selected_warehouse_scope_item();

CREATE FUNCTION enforce_all_warehouse_scope_has_no_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.mode = 'ALL' AND EXISTS (
        SELECT 1
        FROM tenant_user_warehouse_scope_items item
        WHERE item.tenant_id = NEW.tenant_id
          AND item.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'ALL warehouse scope cannot contain items'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_warehouse_scope_all_has_no_items
BEFORE INSERT OR UPDATE ON tenant_user_warehouse_scopes
FOR EACH ROW EXECUTE FUNCTION enforce_all_warehouse_scope_has_no_items();

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('a3000000-0000-0000-0000-000000000008',
     'iam:warehouse:scope:read', 'iam',
     'Read warehouse scopes',
     'Read tenant member warehouse data scopes'),
    ('a3000000-0000-0000-0000-000000000009',
     'iam:warehouse:scope:write', 'iam',
     'Write warehouse scopes',
     'Manage tenant member warehouse data scopes')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- Existing tenant administrators receive the governance permissions. Ordinary
-- roles receive no automatic grant.
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
  AND permission.code IN (
      'iam:warehouse:scope:read',
      'iam:warehouse:scope:write'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Compatibility initialization preserves effective warehouse access as of V40:
-- users with either existing warehouse feature permission retain ALL, while
-- all other ordinary users start with an explicit deny-all SELECTED scope.
INSERT INTO tenant_user_warehouse_scopes (
    tenant_id,
    user_id,
    mode
)
SELECT
    account.tenant_id,
    account.id,
    CASE WHEN EXISTS (
        SELECT 1
        FROM user_roles assignment
        JOIN role_permissions role_permission
          ON role_permission.tenant_id = assignment.tenant_id
         AND role_permission.role_id = assignment.role_id
        JOIN permissions permission
          ON permission.id = role_permission.permission_id
        WHERE assignment.tenant_id = account.tenant_id
          AND assignment.user_id = account.id
          AND permission.code IN ('warehouses.read', 'warehouses.write')
    ) THEN 'ALL' ELSE 'SELECTED' END
FROM users account
WHERE NOT EXISTS (
    SELECT 1
    FROM user_roles assignment
    JOIN roles role
      ON role.id = assignment.role_id
     AND role.tenant_id = assignment.tenant_id
    WHERE assignment.tenant_id = account.tenant_id
      AND assignment.user_id = account.id
      AND role.system_role = true
      AND role.code = 'tenant_admin'
);
