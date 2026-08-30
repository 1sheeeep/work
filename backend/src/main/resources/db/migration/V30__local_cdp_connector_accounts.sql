ALTER TABLE boss_accounts DROP CONSTRAINT IF EXISTS ck_boss_accounts_gateway;
ALTER TABLE boss_accounts DROP CONSTRAINT IF EXISTS ck_boss_accounts_mock_profile;

UPDATE boss_accounts
SET gateway_type = 'LOCAL_CDP_CONNECTOR'
WHERE gateway_type = 'BROWSER_COMPANION';

ALTER TABLE boss_accounts
    ADD CONSTRAINT ck_boss_accounts_gateway CHECK (gateway_type IN ('MOCK','LOCAL_CDP_CONNECTOR')),
    ADD CONSTRAINT ck_boss_accounts_mock_profile CHECK (
        (gateway_type = 'MOCK' AND mock_profile IN ('FULL','READ_ONLY','UNAVAILABLE')) OR
        (gateway_type = 'LOCAL_CDP_CONNECTOR' AND mock_profile IS NULL)
    );
