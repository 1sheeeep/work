UPDATE email_outbox
SET status = 'failed', updated_at = NOW()
WHERE status = 'ambiguous'
  AND provider_metadata = '{}'::jsonb
  AND message_id = ''
  AND last_error = 'conflict: conversation must be claimed before replying';
