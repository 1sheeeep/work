-- Inventory event names include warehouse-transfer variants longer than 24 characters.

ALTER TABLE inventory_ledger_events
    ALTER COLUMN event_type TYPE VARCHAR(48);
