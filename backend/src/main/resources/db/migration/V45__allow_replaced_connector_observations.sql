ALTER TABLE local_connector_unread_observations
    DROP CONSTRAINT ck_local_connector_observation_resolution;

ALTER TABLE local_connector_unread_observations
    ADD CONSTRAINT ck_local_connector_observation_resolution
        CHECK (resolution_status IN ('UNRESOLVED', 'HR_REPLIED', 'SOURCE_REPLACED'));
