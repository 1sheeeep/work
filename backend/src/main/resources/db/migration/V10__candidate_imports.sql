ALTER TABLE candidate_profiles DROP CONSTRAINT ck_candidate_source;
ALTER TABLE candidate_profiles ADD CONSTRAINT ck_candidate_source CHECK (source IN ('BOSS_MOCK', 'MANUAL', 'IMPORT'));

CREATE TABLE candidate_import_batches (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    job_position_id UUID NOT NULL REFERENCES job_positions(id),
    source_filename VARCHAR(255) NOT NULL,
    file_format VARCHAR(8) NOT NULL,
    status VARCHAR(20) NOT NULL,
    total_rows INTEGER NOT NULL,
    valid_rows INTEGER NOT NULL,
    invalid_rows INTEGER NOT NULL,
    duplicate_rows INTEGER NOT NULL,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT ck_candidate_import_format CHECK (file_format IN ('CSV', 'XLSX')),
    CONSTRAINT ck_candidate_import_status CHECK (status IN ('PREVIEWED', 'COMPLETED', 'FAILED')),
    CONSTRAINT ck_candidate_import_counts CHECK (total_rows >= 0 AND valid_rows >= 0 AND invalid_rows >= 0 AND duplicate_rows >= 0 AND imported_rows >= 0)
);

CREATE INDEX idx_candidate_import_batches_company_created ON candidate_import_batches(company_id, created_at DESC);

CREATE TABLE candidate_import_rows (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES candidate_import_batches(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    dedup_key CHAR(64) NOT NULL,
    display_name VARCHAR(100),
    current_title VARCHAR(120),
    years_experience INTEGER,
    education VARCHAR(80),
    skills_summary TEXT,
    status VARCHAR(24) NOT NULL,
    validation_message VARCHAR(500),
    imported_contact_id UUID REFERENCES candidate_job_contacts(id),
    CONSTRAINT uq_candidate_import_row UNIQUE (batch_id, row_number),
    CONSTRAINT ck_candidate_import_row_status CHECK (status IN ('VALID', 'INVALID', 'DUPLICATE_FILE', 'DUPLICATE_EXISTING', 'IMPORTED')),
    CONSTRAINT ck_candidate_import_row_experience CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 60)
);

CREATE INDEX idx_candidate_import_rows_batch_status ON candidate_import_rows(batch_id, status, row_number);
