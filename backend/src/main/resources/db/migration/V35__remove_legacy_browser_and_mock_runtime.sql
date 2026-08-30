-- Retain only the local CDP connector account type and remove obsolete mock metadata.
UPDATE boss_accounts SET gateway_type='LOCAL_CDP_CONNECTOR', mock_profile=NULL WHERE gateway_type='MOCK';
ALTER TABLE boss_accounts DROP CONSTRAINT IF EXISTS ck_boss_accounts_mock_profile;
ALTER TABLE boss_accounts DROP CONSTRAINT IF EXISTS ck_boss_accounts_gateway;
ALTER TABLE boss_accounts DROP COLUMN IF EXISTS mock_profile;
ALTER TABLE boss_accounts ALTER COLUMN gateway_type SET DEFAULT 'LOCAL_CDP_CONNECTOR';
ALTER TABLE boss_accounts ADD CONSTRAINT ck_boss_accounts_gateway CHECK (gateway_type='LOCAL_CDP_CONNECTOR');

-- Normalize the candidate sources still supported by the current product.
UPDATE candidate_profiles SET source='BOSS' WHERE source='BOSS_MOCK';
UPDATE candidate_profiles SET source='MANUAL' WHERE source='IMPORT';
ALTER TABLE candidate_profiles DROP CONSTRAINT IF EXISTS ck_candidate_source;
ALTER TABLE candidate_profiles ADD CONSTRAINT ck_candidate_source CHECK (source IN ('BOSS','MANUAL'));

-- Remove extension-era conversation binding and DOM send lease storage.
DROP TABLE IF EXISTS browser_send_claims;
DROP TABLE IF EXISTS browser_conversation_bindings;
ALTER TABLE browser_unread_observations DROP CONSTRAINT IF EXISTS ck_browser_observation_fill_status;
DROP INDEX IF EXISTS uk_browser_observation_fill_claim;
ALTER TABLE browser_unread_observations
    DROP COLUMN IF EXISTS fill_status,
    DROP COLUMN IF EXISTS fill_claim_id,
    DROP COLUMN IF EXISTS fill_device_id,
    DROP COLUMN IF EXISTS fill_lease_until,
    DROP COLUMN IF EXISTS filled_at;

-- Rename the retained runtime tables to match the local connector architecture.
ALTER TABLE browser_pairing_codes RENAME TO local_connector_pairing_codes;
ALTER TABLE browser_companion_devices RENAME TO local_connector_devices;
ALTER TABLE browser_unread_observations RENAME TO local_connector_unread_observations;
