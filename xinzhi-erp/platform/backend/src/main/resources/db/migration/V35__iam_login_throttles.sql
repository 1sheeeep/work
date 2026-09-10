CREATE TABLE iam_login_throttles (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    failed_count INTEGER NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT fk_iam_login_throttles_user_tenant
        FOREIGN KEY (user_id, tenant_id)
        REFERENCES users (id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT ck_iam_login_throttles_failed_count
        CHECK (failed_count >= 0),
    CONSTRAINT ck_iam_login_throttles_lock
        CHECK (
            locked_until IS NULL
            OR locked_until > window_started_at
        ),
    CONSTRAINT ck_iam_login_throttles_updated
        CHECK (updated_at >= window_started_at)
);

CREATE INDEX idx_iam_login_throttles_locked
    ON iam_login_throttles (locked_until)
    WHERE locked_until IS NOT NULL;
