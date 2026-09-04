ALTER TABLE local_connector_action_leases
    ALTER COLUMN before_state_digest TYPE VARCHAR(64),
    ALTER COLUMN after_state_digest TYPE VARCHAR(64);
