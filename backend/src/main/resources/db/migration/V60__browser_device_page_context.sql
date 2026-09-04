ALTER TABLE local_connector_devices
    ADD COLUMN page_context VARCHAR(24) NOT NULL DEFAULT 'NO_BOSS_PAGE';

ALTER TABLE local_connector_devices
    ADD CONSTRAINT ck_local_connector_devices_page_context
    CHECK (page_context IN ('CHAT', 'JOB_LIST', 'JOB_DETAIL', 'OTHER_BOSS', 'NO_BOSS_PAGE'));
