ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS identity_phone_digest CHAR(64),
    ADD COLUMN IF NOT EXISTS identity_email_digest CHAR(64);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_company_phone
    ON candidate_profiles(company_id, identity_phone_digest)
    WHERE identity_phone_digest IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_company_email
    ON candidate_profiles(company_id, identity_email_digest)
    WHERE identity_email_digest IS NOT NULL;
