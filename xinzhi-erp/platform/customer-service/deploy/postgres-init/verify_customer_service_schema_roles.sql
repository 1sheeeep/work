WITH role_ids AS (
  SELECT
    (SELECT oid FROM pg_roles WHERE rolname = 'customer_service_migrator') AS migrator_oid,
    (SELECT oid FROM pg_roles WHERE rolname = 'customer_service_runtime') AS runtime_oid
), non_owner_default_grants AS (
  SELECT COALESCE(n.nspname, '') AS nspname, d.defaclobjtype, grants.grantee,
         grants.privilege_type, grants.is_grantable,
         roles.runtime_oid
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS grants
  CROSS JOIN role_ids roles
  WHERE d.defaclrole = roles.migrator_oid
    AND grants.grantee <> roles.migrator_oid
)
SELECT CASE WHEN
  to_regclass('customer_service.customer_service_schema_migrations') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM pg_roles role
    WHERE role.rolname = 'customer_service_migrator'
      AND NOT role.rolsuper AND NOT role.rolcreaterole AND NOT role.rolcreatedb
      AND NOT role.rolreplication AND NOT role.rolbypassrls
      AND 'search_path=customer_service, pg_catalog' = ANY(role.rolconfig)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members membership
        WHERE membership.member = role.oid OR membership.roleid = role.oid)
  )
  AND EXISTS (
    SELECT 1 FROM pg_roles role
    WHERE role.rolname = 'customer_service_runtime'
      AND NOT role.rolsuper AND NOT role.rolcreaterole AND NOT role.rolcreatedb
      AND NOT role.rolreplication AND NOT role.rolbypassrls
      AND 'search_path=customer_service, pg_catalog' = ANY(role.rolconfig)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members membership
        WHERE membership.member = role.oid OR membership.roleid = role.oid)
  )
  AND (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'customer_service') = 'customer_service_migrator'
  AND NOT has_database_privilege('customer_service_migrator', current_database(), 'CREATE')
  AND NOT has_database_privilege('customer_service_runtime', current_database(), 'CREATE')
  AND NOT has_database_privilege('customer_service_migrator', current_database(), 'TEMP')
  AND NOT has_database_privilege('customer_service_runtime', current_database(), 'TEMP')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p','S','v','m','f')
      AND pg_get_userbyid(c.relowner) <> 'customer_service_migrator'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
    WHERE n.nspname = 'customer_service'
      AND (
        pg_get_userbyid(routine.proowner) <> 'customer_service_migrator'
        OR routine.prosecdef
        OR has_function_privilege('customer_service_runtime', routine.oid, 'EXECUTE')
        OR EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
          WHERE acl.grantee <> routine.proowner
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_attribute column_acl
    JOIN pg_class relation ON relation.oid = column_acl.attrelid
    JOIN pg_namespace n ON n.oid = relation.relnamespace
    WHERE n.nspname = 'customer_service'
      AND relation.relkind IN ('r','p','v','m','f')
      AND column_acl.attnum > 0 AND NOT column_acl.attisdropped
      AND column_acl.attacl IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND pg_get_userbyid(c.relowner) IN ('customer_service_migrator','customer_service_runtime')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND (
        has_schema_privilege('customer_service_migrator', n.oid, 'CREATE')
        OR has_schema_privilege('customer_service_runtime', n.oid, 'CREATE')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
    WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND (
        has_function_privilege('customer_service_runtime', routine.oid, 'EXECUTE')
        OR has_function_privilege('customer_service_migrator', routine.oid, 'EXECUTE')
      )
  )
  AND has_schema_privilege('customer_service_runtime', 'customer_service', 'USAGE')
  AND NOT has_schema_privilege('customer_service_runtime', 'customer_service', 'CREATE')
  AND (
    SELECT COUNT(*) FILTER (WHERE acl.grantee <> n.nspowner) = 1
      AND COUNT(*) FILTER (WHERE acl.grantee = (SELECT runtime_oid FROM role_ids)
        AND NOT acl.is_grantable AND acl.privilege_type = 'USAGE') = 1
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
    WHERE n.nspname = 'customer_service'
  )
  AND (
    SELECT
      COUNT(*) FILTER (WHERE
        nspname = 'customer_service'
        AND grantee = runtime_oid
        AND NOT is_grantable
        AND ((defaclobjtype = 'r' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
          OR (defaclobjtype = 'S' AND privilege_type = 'USAGE'))
      ) = 5
      AND COUNT(*) FILTER (WHERE NOT (
        nspname = 'customer_service'
        AND grantee = runtime_oid
        AND NOT is_grantable
        AND ((defaclobjtype = 'r' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
          OR (defaclobjtype = 'S' AND privilege_type = 'USAGE'))
      )) = 0
    FROM non_owner_default_grants
  )
  AND EXISTS (
    SELECT 1 FROM pg_default_acl function_defaults
    CROSS JOIN role_ids function_roles
    WHERE function_defaults.defaclrole = function_roles.migrator_oid
      AND function_defaults.defaclnamespace = 0
      AND function_defaults.defaclobjtype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(function_defaults.defaclacl) function_grant
        WHERE function_grant.grantee <> function_roles.migrator_oid
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p')
      AND c.relname <> 'customer_service_schema_migrations'
      AND NOT (
        has_table_privilege('customer_service_runtime', c.oid, 'SELECT')
        AND has_table_privilege('customer_service_runtime', c.oid, 'INSERT')
        AND has_table_privilege('customer_service_runtime', c.oid, 'UPDATE')
        AND has_table_privilege('customer_service_runtime', c.oid, 'DELETE')
        AND NOT has_table_privilege('customer_service_runtime', c.oid, 'TRUNCATE')
        AND NOT has_table_privilege('customer_service_runtime', c.oid, 'REFERENCES')
        AND NOT has_table_privilege('customer_service_runtime', c.oid, 'TRIGGER')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p')
      AND c.relname <> 'customer_service_schema_migrations'
      AND NOT (
        SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 4
          AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
            AND acl.grantee = (SELECT runtime_oid FROM role_ids)
            AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) = 4
        FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      )
  )
  AND has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'SELECT')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'INSERT')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'UPDATE')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'DELETE')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'TRUNCATE')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'REFERENCES')
  AND NOT has_table_privilege('customer_service_runtime', to_regclass('customer_service.customer_service_schema_migrations'), 'TRIGGER')
  AND (
    SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 1
      AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
        AND acl.grantee = (SELECT runtime_oid FROM role_ids)
        AND acl.privilege_type = 'SELECT') = 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE n.nspname = 'customer_service'
      AND c.relname = 'customer_service_schema_migrations'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind = 'S'
      AND NOT (
        has_sequence_privilege('customer_service_runtime', c.oid, 'USAGE')
        AND NOT has_sequence_privilege('customer_service_runtime', c.oid, 'SELECT')
        AND NOT has_sequence_privilege('customer_service_runtime', c.oid, 'UPDATE')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind IN ('v','m','f')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'customer_service' AND c.relkind = 'S'
      AND NOT (
        SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 1
          AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
            AND acl.grantee = (SELECT runtime_oid FROM role_ids)
            AND acl.privilege_type = 'USAGE') = 1
        FROM aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) acl
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND c.relkind IN ('r','p','v','m','f')
      AND (
        has_table_privilege('customer_service_runtime', c.oid, 'INSERT')
        OR has_table_privilege('customer_service_runtime', c.oid, 'UPDATE')
        OR has_table_privilege('customer_service_runtime', c.oid, 'DELETE')
        OR has_table_privilege('customer_service_runtime', c.oid, 'TRUNCATE')
        OR has_table_privilege('customer_service_runtime', c.oid, 'REFERENCES')
        OR has_table_privilege('customer_service_runtime', c.oid, 'TRIGGER')
        OR has_any_column_privilege('customer_service_runtime', c.oid, 'INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('customer_service_migrator', c.oid, 'INSERT')
        OR has_table_privilege('customer_service_migrator', c.oid, 'UPDATE')
        OR has_table_privilege('customer_service_migrator', c.oid, 'DELETE')
        OR has_table_privilege('customer_service_migrator', c.oid, 'TRUNCATE')
        OR has_table_privilege('customer_service_migrator', c.oid, 'REFERENCES')
        OR has_table_privilege('customer_service_migrator', c.oid, 'TRIGGER')
        OR has_any_column_privilege('customer_service_migrator', c.oid, 'INSERT,UPDATE,REFERENCES')
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
      AND c.relkind = 'S'
      AND (
        has_sequence_privilege('customer_service_runtime', c.oid, 'USAGE')
        OR has_sequence_privilege('customer_service_runtime', c.oid, 'SELECT')
        OR has_sequence_privilege('customer_service_runtime', c.oid, 'UPDATE')
        OR has_sequence_privilege('customer_service_migrator', c.oid, 'USAGE')
        OR has_sequence_privilege('customer_service_migrator', c.oid, 'SELECT')
        OR has_sequence_privilege('customer_service_migrator', c.oid, 'UPDATE')
      )
  )
THEN 'compatible' ELSE 'drift' END;
