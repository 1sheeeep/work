UPDATE browser_pairing_codes p
SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
FROM boss_accounts a
WHERE p.boss_account_id = a.id
  AND a.gateway_type = 'MOCK'
  AND p.used_at IS NULL;

UPDATE browser_companion_devices d
SET status = 'REVOKED',
    runtime_state = 'OFFLINE',
    stop_reason = '旧 Mock 浏览器设备已隔离，请改用正式 BROWSER_COMPANION 账号配对',
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
    token_hash = md5(d.id::text) || md5('revoked-mock-' || d.id::text)
FROM boss_accounts a
WHERE d.boss_account_id = a.id
  AND a.gateway_type = 'MOCK'
  AND d.status = 'ACTIVE';

UPDATE auto_reply_policies p
SET enabled = FALSE,
    auto_send_enabled = FALSE,
    away_mode = 'IN_OFFICE',
    away_started_at = NULL,
    away_ends_at = NULL,
    paused_until = NULL,
    updated_at = CURRENT_TIMESTAMP
FROM boss_accounts a
WHERE p.boss_account_id = a.id
  AND a.gateway_type = 'MOCK';
