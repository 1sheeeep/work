CREATE UNIQUE INDEX uq_system_users_username_lower ON system_users (LOWER(username));

CREATE TABLE user_company_scopes (
    user_id UUID NOT NULL REFERENCES system_users(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, company_id)
);

CREATE INDEX idx_user_company_scopes_company ON user_company_scopes(company_id);
