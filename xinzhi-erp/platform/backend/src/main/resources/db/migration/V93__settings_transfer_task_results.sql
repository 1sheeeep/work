ALTER TABLE tenant_order_transfer_jobs
    ADD COLUMN created_by_user_id UUID,
    ADD COLUMN created_by_system_admin_id UUID,
    ADD COLUMN result_filename VARCHAR(200),
    ADD COLUMN result_media_type VARCHAR(100),
    ADD COLUMN result_content BYTEA;

ALTER TABLE tenant_order_transfer_jobs
    ADD CONSTRAINT fk_order_transfer_jobs_created_by_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_order_transfer_jobs_created_by_system_admin
        FOREIGN KEY (created_by_system_admin_id)
        REFERENCES system_admins (id),
    ADD CONSTRAINT ck_order_transfer_jobs_actor
        CHECK (
            (created_by_user_id IS NULL AND created_by_system_admin_id IS NULL)
            OR (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        ),
    ADD CONSTRAINT ck_order_transfer_jobs_result
        CHECK (
            result_content IS NULL
            OR (
                job_type = 'EXPORT'
                AND status = 'SUCCEEDED'
                AND result_filename IS NOT NULL
                AND result_media_type IS NOT NULL
                AND octet_length(result_content) <= 16777216
            )
        );

UPDATE tenant_order_transfer_jobs
SET result_filename = substring(object_reference FROM 8)
WHERE job_type = 'EXPORT'
  AND object_reference LIKE 'inline:%'
  AND length(object_reference) > 7;

CREATE INDEX idx_order_transfer_jobs_settings_list
    ON tenant_order_transfer_jobs (
        tenant_id, job_type, status, created_at DESC, id DESC
    )
    WHERE job_type IN ('IMPORT', 'EXPORT');
