-- Bind platform browser grants to the selected enterprise without adding an enterprise member.
ALTER TABLE one_oidc_login_grants DROP CONSTRAINT ck_one_oidc_grant_subject;
ALTER TABLE one_oidc_login_grants ADD CONSTRAINT ck_one_oidc_grant_subject CHECK (
    (tenant_id IS NOT NULL AND user_id IS NOT NULL AND system_admin_id IS NULL)
    OR (user_id IS NULL AND system_admin_id IS NOT NULL)
);
ALTER TABLE one_oidc_login_grants ADD CONSTRAINT fk_one_oidc_grant_enterprise
    FOREIGN KEY (tenant_id) REFERENCES tenants(id);
