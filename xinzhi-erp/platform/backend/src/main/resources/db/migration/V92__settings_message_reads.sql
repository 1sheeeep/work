-- V92: per-actor read receipts for active internal notices shown in the
-- tenant message center.

ALTER TABLE tenant_internal_notices
    ADD CONSTRAINT uq_internal_notices_tenant_id UNIQUE (tenant_id, id);

CREATE TABLE tenant_internal_notice_reads (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    notice_id UUID NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    actor_id UUID NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, notice_id, actor_type, actor_id),
    CONSTRAINT fk_internal_notice_reads_notice
        FOREIGN KEY (tenant_id, notice_id)
        REFERENCES tenant_internal_notices (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ck_internal_notice_reads_actor_type CHECK (
        actor_type IN ('USER', 'SYSTEM_ADMIN')
    )
);

CREATE INDEX idx_internal_notice_reads_actor
    ON tenant_internal_notice_reads (
        tenant_id, actor_type, actor_id, read_at DESC, notice_id
    );
