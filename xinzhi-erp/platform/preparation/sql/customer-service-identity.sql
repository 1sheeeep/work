-- Explicit preparation installation ONLY. Not in the automatic CS migrations.
-- Run as customer_service_migrator after native migrations, never in ERP.
-- Keep the native single-schema ownership and default CRUD grants unchanged.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
  IF current_user <> 'customer_service_migrator' THEN
    RAISE EXCEPTION 'identity preparation requires the native migration owner';
  END IF;
END $$;
CREATE TABLE customer_service.identity_preparation_revisions (
  user_id text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO customer_service.identity_preparation_revisions(user_id) SELECT id FROM customer_service.users;
CREATE FUNCTION customer_service.identity_preparation_record_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO customer_service.identity_preparation_revisions(user_id,revision) VALUES(OLD.id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=customer_service.identity_preparation_revisions.revision+1;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' OR (OLD.password_hash,OLD.status,OLD.email,OLD.system_admin) IS DISTINCT FROM
                       (NEW.password_hash,NEW.status,NEW.email,NEW.system_admin) THEN
    INSERT INTO customer_service.identity_preparation_revisions(user_id,revision) VALUES(NEW.id,1)
    ON CONFLICT(user_id) DO UPDATE SET revision=customer_service.identity_preparation_revisions.revision+1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_preparation_revision AFTER INSERT OR UPDATE OR DELETE ON customer_service.users
FOR EACH ROW EXECUTE FUNCTION customer_service.identity_preparation_record_revision();
CREATE TABLE customer_service.identity_preparation_tokens (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
  kind text NOT NULL CHECK(kind IN ('grant','lease')),
  payload jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX ON customer_service.identity_preparation_tokens(expires_at);
CREATE TABLE customer_service.identity_preparation_login_windows (
  scope text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts > 0)
);
REVOKE ALL ON FUNCTION customer_service.identity_preparation_record_revision() FROM PUBLIC,customer_service_runtime;
COMMIT;
