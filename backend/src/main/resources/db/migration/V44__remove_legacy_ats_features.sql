DELETE FROM boss_account_capabilities WHERE capability = 'INTERVIEW_INVITE';

ALTER TABLE boss_account_capabilities DROP CONSTRAINT IF EXISTS ck_boss_account_capability;
ALTER TABLE boss_account_capabilities ADD CONSTRAINT ck_boss_account_capability
    CHECK (capability IN ('JOB_SYNC', 'CANDIDATE_READ', 'MESSAGE_SEND'));

DROP TABLE IF EXISTS notification_attempts, hr_notifications, interview_slots, interview_schedules CASCADE;
DROP TABLE IF EXISTS recruitment_task_leases, recruitment_task_executions, recruitment_tasks CASCADE;
DROP TABLE IF EXISTS candidate_import_rows, candidate_import_batches CASCADE;
