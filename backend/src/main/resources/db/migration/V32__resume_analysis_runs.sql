ALTER TABLE ai_assistance_runs
    ADD COLUMN resume_intake_id UUID REFERENCES resume_intakes(id);

ALTER TABLE ai_assistance_runs
    DROP CONSTRAINT ck_ai_assistance_type;

ALTER TABLE ai_assistance_runs
    ADD CONSTRAINT ck_ai_assistance_type
        CHECK (assistance_type IN ('JOB_PARSE', 'CANDIDATE_SCREEN', 'RESUME_ANALYSIS'));

CREATE INDEX idx_ai_runs_resume_intake_created
    ON ai_assistance_runs(resume_intake_id, created_at DESC);
