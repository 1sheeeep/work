CREATE TABLE IF NOT EXISTS data_migration_markers (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM data_migration_markers
    WHERE name = '022_unify_email_conversations'
  ) THEN
    UPDATE conversations AS conversation
    SET kind = 'customer',
        reply_allowed = CASE
          WHEN trim(conversation.customer_email) = '' THEN FALSE
          WHEN lower(conversation.customer_email) ~ '(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster)([._+@-]|$)' THEN FALSE
          ELSE TRUE
        END,
        classification_reason = 'email handled as a normal conversation',
        updated_at = NOW()
    FROM shop_sources AS source
    WHERE conversation.source_id = source.id
      AND source.type = 'email'
      AND conversation.kind = 'system'
      AND conversation.classification_reason NOT IN (
        'automated platform or account notification',
        'verification code or authentication notice',
        'automated email pending review'
      );

    INSERT INTO data_migration_markers (name)
    VALUES ('022_unify_email_conversations')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END
$migration$;
