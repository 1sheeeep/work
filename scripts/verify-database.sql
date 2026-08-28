\set ON_ERROR_STOP on

SELECT version, description, success
FROM flyway_schema_history
ORDER BY installed_rank DESC
LIMIT 1;

SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_logs_append_only' AND NOT tgisinternal
) AS audit_append_only_trigger;

SELECT count(*) AS new_audit_rows_without_request_id
FROM audit_logs
WHERE occurred_at >= (SELECT installed_on FROM flyway_schema_history WHERE version = '8')
  AND request_id IS NULL;

DO $$
DECLARE audit_id UUID;
BEGIN
    SELECT id INTO audit_id FROM audit_logs ORDER BY occurred_at DESC LIMIT 1;
    IF audit_id IS NULL THEN RAISE EXCEPTION 'audit log fixture missing'; END IF;
    BEGIN
        UPDATE audit_logs SET details = details WHERE id = audit_id;
        RAISE EXCEPTION 'append-only update protection missing';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'audit_logs is append-only' THEN RAISE; END IF;
    END;
    BEGIN
        DELETE FROM audit_logs WHERE id = audit_id;
        RAISE EXCEPTION 'append-only delete protection missing';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'audit_logs is append-only' THEN RAISE; END IF;
    END;
END $$;

SELECT 'database hardening verified' AS result;
