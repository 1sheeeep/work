ALTER TABLE first_party_application_entry_grants
    DROP CONSTRAINT ck_first_party_entry_target_application;

ALTER TABLE first_party_application_entry_grants
    ADD CONSTRAINT ck_first_party_entry_target_application CHECK (
        target_application IN (
            'ONE', 'ERP', 'ZHAOYAOJING', 'ASSET_REGISTRY'
        )
    );
