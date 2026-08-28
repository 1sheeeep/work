CREATE TABLE candidate_profiles (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    source VARCHAR(24) NOT NULL,
    dedup_key CHAR(64) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    current_title VARCHAR(120),
    years_experience INTEGER,
    education VARCHAR(80),
    skills_summary TEXT,
    privacy_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_candidate_company_source_dedup UNIQUE (company_id, source, dedup_key),
    CONSTRAINT ck_candidate_source CHECK (source IN ('BOSS_MOCK', 'MANUAL')),
    CONSTRAINT ck_candidate_experience CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 60),
    CONSTRAINT ck_candidate_privacy CHECK (privacy_status IN ('ACTIVE', 'ANONYMIZED'))
);

CREATE INDEX idx_candidate_profiles_company_created ON candidate_profiles(company_id, created_at DESC);

CREATE TABLE candidate_job_contacts (
    id UUID PRIMARY KEY,
    candidate_id UUID NOT NULL REFERENCES candidate_profiles(id),
    job_position_id UUID NOT NULL REFERENCES job_positions(id),
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    status VARCHAR(24) NOT NULL DEFAULT 'NEW',
    human_taken_over BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_hr_id UUID REFERENCES system_users(id),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_candidate_job_contact UNIQUE (candidate_id, job_position_id),
    CONSTRAINT ck_candidate_contact_status CHECK (status IN ('NEW', 'SCREENING', 'QUALIFIED', 'REJECTED', 'CONTACTING'))
);

CREATE INDEX idx_candidate_contacts_job_status ON candidate_job_contacts(job_position_id, status, created_at DESC);

CREATE TABLE screening_decisions (
    id UUID PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES candidate_job_contacts(id),
    decision_type VARCHAR(24) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    engine_version VARCHAR(80),
    model_version VARCHAR(80),
    prompt_version VARCHAR(80),
    rationale TEXT NOT NULL,
    created_by UUID REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_screening_decision_type CHECK (decision_type IN ('HARD_RULE', 'AI_SUGGESTION', 'HUMAN_OVERRIDE')),
    CONSTRAINT ck_screening_outcome CHECK (outcome IN ('PASS', 'REJECT', 'REVIEW'))
);

CREATE INDEX idx_screening_decisions_contact_created ON screening_decisions(contact_id, created_at DESC);

CREATE TABLE conversation_messages (
    id UUID PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES candidate_job_contacts(id),
    external_message_id VARCHAR(120) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    sender_type VARCHAR(16) NOT NULL,
    delivery_status VARCHAR(24) NOT NULL,
    content TEXT NOT NULL,
    model_version VARCHAR(80),
    prompt_version VARCHAR(80),
    created_by UUID REFERENCES system_users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_conversation_message_external UNIQUE (contact_id, external_message_id),
    CONSTRAINT ck_conversation_direction CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_conversation_sender CHECK (sender_type IN ('CANDIDATE', 'AI', 'HR', 'SYSTEM')),
    CONSTRAINT ck_conversation_delivery CHECK (delivery_status IN ('RECEIVED', 'PENDING_REVIEW', 'SENT', 'REJECTED', 'FAILED'))
);

CREATE INDEX idx_conversation_messages_contact_created ON conversation_messages(contact_id, created_at DESC);
