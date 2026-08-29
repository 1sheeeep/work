ALTER TABLE companies
    ADD COLUMN knowledge_industry VARCHAR(120),
    ADD COLUMN knowledge_scale VARCHAR(120),
    ADD COLUMN knowledge_summary TEXT,
    ADD COLUMN knowledge_approved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN knowledge_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN knowledge_approved_at TIMESTAMPTZ;

ALTER TABLE job_positions
    ADD COLUMN reply_summary TEXT,
    ADD COLUMN salary_display VARCHAR(120),
    ADD COLUMN knowledge_approved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN knowledge_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN knowledge_approved_at TIMESTAMPTZ;
