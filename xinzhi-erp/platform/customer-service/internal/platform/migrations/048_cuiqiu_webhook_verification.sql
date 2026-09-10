ALTER TABLE cuiqiu_domain_settings
  ADD COLUMN IF NOT EXISTS webhook_verified_at TIMESTAMPTZ NULL;

WITH observed_domains AS (
  SELECT
    LOWER(SPLIT_PART(address, '@', 2)) AS domain,
    MAX((metadata->>'cuiqiu_webhook_received_at')::timestamptz) AS verified_at
  FROM shop_sources
  WHERE type = 'email'
    AND provider = 'cuiqiu'
    AND metadata ? 'cuiqiu_webhook_received_at'
    AND pg_input_is_valid(metadata->>'cuiqiu_webhook_received_at', 'timestamptz')
  GROUP BY LOWER(SPLIT_PART(address, '@', 2))
)
UPDATE cuiqiu_domain_settings AS settings
SET webhook_verified_at = observed.verified_at
FROM observed_domains AS observed
WHERE settings.domain = observed.domain
  AND settings.webhook_verified_at IS NULL;
