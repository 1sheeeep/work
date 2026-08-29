ALTER TABLE boss_accounts DROP CONSTRAINT ck_boss_accounts_gateway;
ALTER TABLE boss_accounts DROP CONSTRAINT ck_boss_accounts_mock_profile;
ALTER TABLE boss_accounts ALTER COLUMN mock_profile DROP NOT NULL;
ALTER TABLE boss_accounts
    ADD CONSTRAINT ck_boss_accounts_gateway CHECK (gateway_type IN ('MOCK','BROWSER_COMPANION')),
    ADD CONSTRAINT ck_boss_accounts_mock_profile CHECK (
        (gateway_type = 'MOCK' AND mock_profile IN ('FULL','READ_ONLY','UNAVAILABLE')) OR
        (gateway_type = 'BROWSER_COMPANION' AND mock_profile IS NULL)
    );

