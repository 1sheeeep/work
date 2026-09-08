ALTER TABLE auto_reply_policies DROP CONSTRAINT ck_auto_reply_timeout;

ALTER TABLE auto_reply_policies
    ADD CONSTRAINT ck_auto_reply_timeout
        CHECK (response_timeout_minutes BETWEEN 0 AND 10080);
