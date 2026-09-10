-- V90: tenant-scoped operational task management.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '90900000-0000-0000-0000-000000000001',
    'settings.task.write',
    'settings',
    'Manage operational tasks',
    'Create, assign, progress, complete, restore, and export tenant tasks'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'settings.task.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_operational_tasks (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    task_no VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    category VARCHAR(80) NOT NULL,
    task_object VARCHAR(160) NOT NULL,
    urgency VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    assignee_name VARCHAR(160) NOT NULL,
    description VARCHAR(1000),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    completed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_operational_tasks_tenant_no UNIQUE (tenant_id, task_no),
    CONSTRAINT fk_operational_tasks_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_operational_tasks_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_operational_tasks_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_operational_tasks_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_operational_tasks_text CHECK (
        task_no = btrim(task_no)
        AND task_no ~ '^TASK-[0-9]{8}-[A-Z0-9]{6}$'
        AND title = btrim(title)
        AND char_length(title) BETWEEN 1 AND 160
        AND title !~ '[[:cntrl:]]'
        AND category = btrim(category)
        AND char_length(category) BETWEEN 1 AND 80
        AND category !~ '[[:cntrl:]]'
        AND task_object = btrim(task_object)
        AND char_length(task_object) BETWEEN 1 AND 160
        AND task_object !~ '[[:cntrl:]]'
        AND assignee_name = btrim(assignee_name)
        AND char_length(assignee_name) BETWEEN 1 AND 160
        AND assignee_name !~ '[[:cntrl:]]'
        AND created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND (description IS NULL OR (
            description = btrim(description)
            AND char_length(description) BETWEEN 1 AND 1000
            AND description !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_operational_tasks_urgency CHECK (
        urgency IN ('NORMAL', 'URGENT')
    ),
    CONSTRAINT ck_operational_tasks_status CHECK (
        status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DELETED')
    ),
    CONSTRAINT ck_operational_tasks_lifecycle CHECK (
        (status = 'COMPLETED') = (completed_at IS NOT NULL)
        AND (status = 'DELETED') = (deleted_at IS NOT NULL)
    ),
    CONSTRAINT ck_operational_tasks_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_operational_tasks_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_operational_tasks_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_operational_tasks_version CHECK (version >= 0),
    CONSTRAINT ck_operational_tasks_timestamps CHECK (
        updated_at >= created_at
        AND (completed_at IS NULL OR completed_at >= created_at)
        AND (deleted_at IS NULL OR deleted_at >= created_at)
    )
);

CREATE INDEX idx_operational_tasks_list
    ON tenant_operational_tasks (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX idx_operational_tasks_assignee
    ON tenant_operational_tasks (tenant_id, lower(assignee_name), created_at DESC);
