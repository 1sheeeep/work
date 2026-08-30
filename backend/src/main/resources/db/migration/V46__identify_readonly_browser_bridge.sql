ALTER TABLE local_connector_devices
    ADD COLUMN client_type VARCHAR(40) NOT NULL DEFAULT 'LEGACY_CDP_CONNECTOR',
    ADD COLUMN client_version VARCHAR(32);

UPDATE local_connector_devices
SET client_type = 'BROWSER_READONLY_BRIDGE',
    client_version = '0.1.0'
WHERE display_name LIKE 'Chrome 只读桥接 ·%';

ALTER TABLE local_connector_devices
    ADD CONSTRAINT ck_local_connector_devices_client_type
    CHECK (client_type IN ('BROWSER_READONLY_BRIDGE', 'LEGACY_CDP_CONNECTOR'));
