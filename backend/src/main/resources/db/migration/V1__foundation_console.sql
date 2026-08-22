CREATE TABLE system_users (
    id UUID PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(32) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_system_users_role CHECK (role IN ('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN', 'RECRUITER'))
);

CREATE TABLE group_profiles (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    short_name VARCHAR(60) NOT NULL,
    timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Shanghai',
    description VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE companies (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES group_profiles(id),
    name VARCHAR(120) NOT NULL,
    code VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    location VARCHAR(120),
    notes VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_companies_group_name UNIQUE (group_id, name),
    CONSTRAINT uq_companies_group_code UNIQUE (group_id, code),
    CONSTRAINT ck_companies_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_companies_group_status ON companies(group_id, status);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    actor_user_id UUID REFERENCES system_users(id),
    actor_name VARCHAR(100) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id UUID,
    target_label VARCHAR(160),
    result VARCHAR(16) NOT NULL,
    details VARCHAR(1000),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_audit_logs_result CHECK (result IN ('SUCCESS', 'FAILURE'))
);

CREATE INDEX idx_audit_logs_occurred_at ON audit_logs(occurred_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
