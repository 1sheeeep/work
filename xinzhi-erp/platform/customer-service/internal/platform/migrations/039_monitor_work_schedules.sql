CREATE TABLE IF NOT EXISTS monitor_work_schedule_versions (
    id BIGSERIAL PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    weekdays JSONB NOT NULL DEFAULT '[1,2,3,4,5,6,7]'::jsonb,
    effective_from TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT monitor_work_schedule_start_minute CHECK (start_minute >= 0 AND start_minute < 1440),
    CONSTRAINT monitor_work_schedule_end_minute CHECK (end_minute > 0 AND end_minute <= 1440),
    CONSTRAINT monitor_work_schedule_window CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_monitor_work_schedule_effective
    ON monitor_work_schedule_versions (effective_from, id);
