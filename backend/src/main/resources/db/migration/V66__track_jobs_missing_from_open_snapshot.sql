ALTER TABLE job_positions
    ADD COLUMN missing_from_open_snapshot_count INTEGER NOT NULL DEFAULT 0;

