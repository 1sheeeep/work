-- Catalog only. No business rows, migration execution, stored secrets, ACLs,
-- comments, sequence values, or function/default bodies leave the database.
-- Use psql -X -qAt -v ON_ERROR_STOP=1; never source an environment file.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
SET LOCAL search_path = pg_catalog;
WITH relations AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
), items AS (
  SELECT 'relation' kind, c.relname::text name,
    jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,
      'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
      'replicaIdentity',c.relreplident) properties
  FROM relations c WHERE c.relkind IN ('r','p','v','m','S','f')
  UNION ALL
  SELECT 'column',c.relname||'.'||a.attname,
    jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
      'collation',co.collname,'defaultMd5',md5(pg_get_expr(d.adbin,d.adrelid)))
  FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    LEFT JOIN pg_collation co ON co.oid=a.attcollation
  WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',c.relname||'.'||p.conname,
    jsonb_build_object('type',p.contype,'validated',p.convalidated,
      'definitionMd5',md5(pg_get_constraintdef(p.oid)))
  FROM pg_constraint p JOIN relations c ON c.oid=p.conrelid
  UNION ALL
  SELECT 'index',c.relname||'.'||ic.relname,
    jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,
      'definitionMd5',md5(pg_get_indexdef(i.indexrelid)))
  FROM pg_index i JOIN relations c ON c.oid=i.indrelid
    JOIN pg_class ic ON ic.oid=i.indexrelid
  UNION ALL
  SELECT 'trigger',c.relname||'.'||t.tgname,
    jsonb_build_object('enabled',t.tgenabled,'definitionMd5',md5(pg_get_triggerdef(t.oid)))
  FROM pg_trigger t JOIN relations c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy',c.relname||'.'||p.polname,
    jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
      'usingMd5',md5(pg_get_expr(p.polqual,p.polrelid)),
      'checkMd5',md5(pg_get_expr(p.polwithcheck,p.polrelid)))
  FROM pg_policy p JOIN relations c ON c.oid=p.polrelid
  UNION ALL
  SELECT 'view',c.relname,jsonb_build_object('definitionMd5',md5(pg_get_viewdef(c.oid)))
  FROM relations c WHERE c.relkind IN ('v','m')
  UNION ALL
  SELECT 'routine',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_object('kind',p.prokind,'securityDefiner',p.prosecdef,
      'definitionMd5',md5(pg_get_functiondef(p.oid)))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
)
SELECT jsonb_build_object(
  'format','native-cs-catalog-v1',
  'observedAt',transaction_timestamp(),
  'readOnly',current_setting('transaction_read_only'),
  'isolation',current_setting('transaction_isolation'),
  'serverVersion',current_setting('server_version'),
  'schemas',(SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]'::jsonb)
    FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),
  'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion)
    ORDER BY extname),'[]'::jsonb) FROM pg_extension),
  'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,
    'properties',properties) ORDER BY kind COLLATE "C",name COLLATE "C") FROM items),'[]'::jsonb));
ROLLBACK;
