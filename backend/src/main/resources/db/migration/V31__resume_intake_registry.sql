CREATE TABLE resume_intakes (
    id UUID PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES candidate_job_contacts(id),
    source VARCHAR(24) NOT NULL,
    resume_digest CHAR(64) NOT NULL,
    display_label VARCHAR(120) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
    received_at TIMESTAMPTZ NOT NULL,
    reviewed_by UUID REFERENCES system_users(id),
    reviewed_at TIMESTAMPTZ,
    review_note VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_resume_intake_contact_digest UNIQUE (contact_id, resume_digest),
    CONSTRAINT ck_resume_intake_source CHECK (source IN ('MANUAL', 'BOSS_VISIBLE')),
    CONSTRAINT ck_resume_intake_status CHECK (status IN ('PENDING_REVIEW', 'APPROVED_FOR_AI', 'REJECTED'))
);

CREATE INDEX idx_resume_intakes_contact_received ON resume_intakes(contact_id, received_at DESC);
CREATE INDEX idx_resume_intakes_status_received ON resume_intakes(status, received_at DESC);
