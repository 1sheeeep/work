ALTER TABLE hr_notifications DROP CONSTRAINT ck_hr_notification_channel;
ALTER TABLE hr_notifications ADD CONSTRAINT ck_hr_notification_channel CHECK (channel IN ('IN_APP_MOCK', 'WEBHOOK'));
