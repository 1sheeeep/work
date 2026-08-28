CREATE TABLE job_positions (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    title VARCHAR(120) NOT NULL,
    location VARCHAR(120) NOT NULL,
    salary_min_k INTEGER NOT NULL,
    salary_max_k INTEGER NOT NULL,
    salary_months SMALLINT NOT NULL DEFAULT 12,
    experience_requirement VARCHAR(80) NOT NULL,
    education_requirement VARCHAR(80) NOT NULL,
    description TEXT NOT NULL,
    screening_requirements TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_job_positions_status CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
    CONSTRAINT ck_job_positions_salary_min CHECK (salary_min_k > 0),
    CONSTRAINT ck_job_positions_salary_range CHECK (salary_max_k >= salary_min_k),
    CONSTRAINT ck_job_positions_salary_months CHECK (salary_months BETWEEN 12 AND 16)
);

CREATE INDEX idx_job_positions_company_status ON job_positions(company_id, status);
CREATE INDEX idx_job_positions_boss_account ON job_positions(boss_account_id);
CREATE INDEX idx_job_positions_created_at ON job_positions(created_at DESC);
