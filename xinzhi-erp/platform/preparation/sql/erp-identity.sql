-- Explicit isolated preparation installation. NOT an automatic Flyway migration.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
CREATE SCHEMA integration_preparation;
CREATE TABLE integration_preparation.identity_bindings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  erp_user_id uuid NOT NULL REFERENCES public.users(id),
  cs_user_id text NOT NULL, subject_ref text NOT NULL,
  version bigint NOT NULL CHECK(version > 0 AND version <= 9007199254740991),
  state text NOT NULL CHECK(state IN ('UNREVIEWED','CONFLICT','CONFIRMED','DISABLED')),
  reviewed_by uuid NOT NULL REFERENCES public.users(id), evidence_ref text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,erp_user_id), UNIQUE(tenant_id,cs_user_id), UNIQUE(tenant_id,subject_ref),
  CHECK(length(cs_user_id) BETWEEN 1 AND 128), CHECK(length(subject_ref) BETWEEN 1 AND 128),
  CHECK(length(evidence_ref) BETWEEN 1 AND 128)
);
CREATE TABLE integration_preparation.identity_audit (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, erp_user_id uuid NOT NULL,
  version bigint NOT NULL, state text NOT NULL, actor_id uuid NOT NULL,
  evidence_ref text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_preparation.identity_epochs (
  tenant_id uuid PRIMARY KEY, epoch bigint NOT NULL CHECK(epoch >= 0)
);
INSERT INTO integration_preparation.identity_epochs SELECT id,0 FROM public.tenants;
CREATE TABLE integration_preparation.identity_user_epochs (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, epoch bigint NOT NULL CHECK(epoch >= 0),
  PRIMARY KEY(tenant_id,user_id)
);
INSERT INTO integration_preparation.identity_user_epochs SELECT tenant_id,id,0 FROM public.users;
CREATE FUNCTION integration_preparation.bump_identity_user_epoch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid; member uuid;
BEGIN
  tenant=COALESCE(NEW.tenant_id,OLD.tenant_id);
  IF TG_TABLE_NAME='users' THEN member=COALESCE(NEW.id,OLD.id);
  ELSE member=COALESCE(NEW.user_id,OLD.user_id); END IF;
  INSERT INTO integration_preparation.identity_user_epochs VALUES(tenant,member,1)
  ON CONFLICT(tenant_id,user_id) DO UPDATE SET epoch=integration_preparation.identity_user_epochs.epoch+1;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE FUNCTION integration_preparation.bump_identity_epoch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tenant uuid;
BEGIN
  IF TG_TABLE_NAME='tenants' THEN tenant=COALESCE(NEW.id,OLD.id);
  ELSE tenant=COALESCE(NEW.tenant_id,OLD.tenant_id); END IF;
  INSERT INTO integration_preparation.identity_epochs VALUES(tenant,1)
  ON CONFLICT(tenant_id) DO UPDATE SET epoch=integration_preparation.identity_epochs.epoch+1;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER preparation_account_epoch AFTER UPDATE ON public.users
FOR EACH ROW WHEN ((OLD.status,OLD.password_hash,OLD.email) IS DISTINCT FROM (NEW.status,NEW.password_hash,NEW.email))
EXECUTE FUNCTION integration_preparation.bump_identity_user_epoch();
CREATE TRIGGER preparation_new_account_epoch AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION integration_preparation.bump_identity_user_epoch();
CREATE TRIGGER preparation_tenant_epoch AFTER UPDATE ON public.tenants
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION integration_preparation.bump_identity_epoch();
CREATE TRIGGER preparation_business_access_epoch AFTER INSERT OR UPDATE OR DELETE ON public.user_enabled_applications
FOR EACH ROW EXECUTE FUNCTION integration_preparation.bump_identity_user_epoch();
CREATE TRIGGER preparation_tenant_access_epoch AFTER INSERT OR UPDATE OR DELETE ON public.tenant_enabled_application_modules
FOR EACH ROW EXECUTE FUNCTION integration_preparation.bump_identity_epoch();
CREATE TABLE integration_preparation.identity_sessions (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
  session_id uuid NOT NULL REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL, erp_user_id uuid NOT NULL, binding_version bigint NOT NULL,
  identity_epoch bigint NOT NULL, user_identity_epoch bigint NOT NULL, attempt text NOT NULL,
  lease_nonce bytea NOT NULL, encrypted_lease bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(tenant_id,erp_user_id) REFERENCES integration_preparation.identity_bindings(tenant_id,erp_user_id)
);
REVOKE ALL ON SCHEMA integration_preparation FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA integration_preparation FROM PUBLIC;
COMMIT;
