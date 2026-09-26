CREATE TABLE boss_account_recruiters (
    account_id UUID NOT NULL REFERENCES boss_accounts(id),
    user_id UUID NOT NULL REFERENCES system_users(id),
    PRIMARY KEY (account_id, user_id)
);
CREATE INDEX idx_boss_account_recruiter_user ON boss_account_recruiters(user_id);
-- Existing accounts remain unassigned until an administrator explicitly grants access.
UPDATE local_connector_devices SET status = 'REVOKED', runtime_state = 'OFFLINE', revoked_at = CURRENT_TIMESTAMP
WHERE paired_by IN (SELECT id FROM system_users WHERE role = 'RECRUITER') AND status = 'ACTIVE';
