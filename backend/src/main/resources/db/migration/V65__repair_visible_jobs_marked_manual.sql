UPDATE job_positions
SET capture_source = 'VISIBLE_PAGE',
    capture_completeness = COALESCE(capture_completeness, 1),
    captured_at = COALESCE(captured_at, last_observed_at),
    capture_verified = FALSE,
    capture_verified_at = NULL
WHERE capture_source = 'MANUAL'
  AND status = 'DRAFT'
  AND observed_source_key IS NOT NULL
  AND last_observed_at IS NOT NULL;
