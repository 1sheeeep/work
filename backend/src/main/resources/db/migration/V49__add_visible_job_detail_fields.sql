ALTER TABLE job_positions
    ADD COLUMN recruitment_type VARCHAR(40),
    ADD COLUMN job_category VARCHAR(120),
    ADD COLUMN overseas_requirement VARCHAR(40),
    ADD COLUMN job_keywords VARCHAR(500),
    ADD COLUMN work_address VARCHAR(240);
