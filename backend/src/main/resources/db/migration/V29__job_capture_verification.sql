ALTER TABLE job_positions
    ADD COLUMN capture_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN capture_verified_at TIMESTAMPTZ;
