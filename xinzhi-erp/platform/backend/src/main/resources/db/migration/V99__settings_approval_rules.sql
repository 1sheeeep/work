CREATE TABLE tenant_approval_rules (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    priority SMALLINT NOT NULL,
    name VARCHAR(120) NOT NULL,
    name_key VARCHAR(120) NOT NULL,
    document_type VARCHAR(40) NOT NULL,
    description VARCHAR(500),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_display_name VARCHAR(160) NOT NULL,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_approval_rule_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_approval_rule_name UNIQUE (tenant_id, name_key),
    CONSTRAINT fk_approval_rule_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_approval_rule_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_approval_rule_priority CHECK (priority BETWEEN 1 AND 10),
    CONSTRAINT ck_approval_rule_name CHECK (
        name = btrim(name) AND name_key = lower(name_key)
        AND char_length(name) BETWEEN 1 AND 120
        AND char_length(name_key) BETWEEN 1 AND 120
        AND name !~ '[[:cntrl:]]' AND name_key !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_approval_rule_document_type CHECK (document_type IN (
        'PROCUREMENT_ORDER', 'INVENTORY_COUNT', 'WAREHOUSE_TRANSFER',
        'MANUAL_INBOUND', 'MANUAL_OUTBOUND'
    )),
    CONSTRAINT ck_approval_rule_description CHECK (
        description IS NULL OR (
            description = btrim(description)
            AND char_length(description) BETWEEN 1 AND 500
            AND description !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT ck_approval_rule_display_names CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND created_by_display_name !~ '[[:cntrl:]]'
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_approval_rule_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_approval_rule_request CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    CONSTRAINT ck_approval_rule_version CHECK (version >= 0),
    CONSTRAINT ck_approval_rule_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE tenant_approval_rule_approvers (
    rule_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    approver_user_id UUID NOT NULL,
    step_order SMALLINT NOT NULL,
    PRIMARY KEY (rule_id, step_order),
    CONSTRAINT uq_approval_rule_approver UNIQUE (rule_id, approver_user_id),
    CONSTRAINT fk_approval_rule_approver_rule FOREIGN KEY (tenant_id, rule_id)
        REFERENCES tenant_approval_rules (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_approval_rule_approver_user FOREIGN KEY (approver_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_approval_rule_approver_step CHECK (step_order BETWEEN 1 AND 5)
);

CREATE INDEX ix_approval_rules_tenant_order
    ON tenant_approval_rules (tenant_id, enabled, priority, created_at, id);

CREATE INDEX ix_approval_rule_approvers_user
    ON tenant_approval_rule_approvers (tenant_id, approver_user_id, rule_id);
