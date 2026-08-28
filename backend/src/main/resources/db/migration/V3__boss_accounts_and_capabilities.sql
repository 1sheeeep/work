CREATE TABLE boss_accounts (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    display_name VARCHAR(100) NOT NULL,
    external_identifier VARCHAR(120) NOT NULL,
    gateway_type VARCHAR(16) NOT NULL DEFAULT 'MOCK',
    mock_profile VARCHAR(20) NOT NULL DEFAULT 'FULL',
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    connection_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
    last_checked_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_boss_accounts_gateway CHECK (gateway_type IN ('MOCK')),
    CONSTRAINT ck_boss_accounts_mock_profile CHECK (mock_profile IN ('FULL', 'READ_ONLY', 'UNAVAILABLE')),
    CONSTRAINT ck_boss_accounts_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_boss_accounts_connection CHECK (connection_status IN ('UNVERIFIED', 'CONNECTED', 'DEGRADED', 'UNAVAILABLE'))
);

CREATE UNIQUE INDEX uq_boss_accounts_company_external_lower
    ON boss_accounts(company_id, LOWER(external_identifier));
CREATE INDEX idx_boss_accounts_company_status ON boss_accounts(company_id, status);

CREATE TABLE boss_account_capabilities (
    account_id UUID NOT NULL REFERENCES boss_accounts(id) ON DELETE CASCADE,
    capability VARCHAR(32) NOT NULL,
    PRIMARY KEY (account_id, capability),
    CONSTRAINT ck_boss_account_capability CHECK (
        capability IN ('JOB_SYNC', 'CANDIDATE_READ', 'MESSAGE_SEND', 'INTERVIEW_INVITE')
    )
);
