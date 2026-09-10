-- Explicit authorization required: login/permission configuration and saved
-- installation scope summaries only. Never run from application startup.
-- No credential columns, sessions, messages, account/shop identities or raw
-- metadata are selected. Output consists of allowlisted categories and counts.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='10s';
SET LOCAL search_path=pg_catalog;
WITH safe_users AS MATERIALIZED (
  SELECT CASE WHEN role IN ('admin','agent') THEN role ELSE 'unrecognized' END AS role_class,
    CASE WHEN status IN ('active','disabled') THEN status ELSE 'unrecognized' END AS status_class,
    system_admin, permissions_customized,
    CASE department WHEN '' THEN 'unset'
      WHEN U&'\5ba2\670d\90e8' THEN 'customer_service'
      WHEN U&'\8d22\52a1\90e8' THEN 'finance'
      WHEN U&'\7efc\5408\90e8' THEN 'general' ELSE 'unrecognized' END AS department_class,
    CASE WHEN shop_scope IN ('all','assigned','selected') THEN shop_scope ELSE 'unrecognized' END AS shop_scope_class,
    CASE WHEN workbench_shop_scope IN ('all','assigned','selected') THEN workbench_shop_scope ELSE 'unrecognized' END AS workbench_scope_class,
    jsonb_typeof(permissions)='array' AS permissions_array,
    CASE WHEN jsonb_typeof(permissions)='array' THEN permissions ELSE '[]'::jsonb END AS permission_values,
    jsonb_typeof(data_scopes)='object' AS data_scopes_object,
    CASE WHEN jsonb_typeof(data_scopes)='object' THEN data_scopes ELSE '{}'::jsonb END AS data_scope_values,
    CASE WHEN jsonb_typeof(shop_scope_ids)='array' THEN jsonb_array_length(shop_scope_ids) ELSE NULL END AS selected_shop_count
  FROM public.users
), user_groups AS (
  SELECT role_class,status_class,system_admin,permissions_customized,department_class,shop_scope_class,workbench_scope_class,count(*) AS accounts
  FROM safe_users GROUP BY 1,2,3,4,5,6,7
), relevant_permissions(permission) AS (
  VALUES ('workbench.access'),('routing.auto_receive'),('orders.manage'),('orders.view'),('orders.refund'),('orders.disputes'),
    ('shops.view'),('shops.manage'),('shops.channels.manage'),('users.manage'),('permissions.manage'),('email_statistics.view')
), permission_counts AS (
  SELECT permission,
    (SELECT count(*) FROM safe_users u WHERE u.permission_values ? p.permission) AS stored_accounts,
    (SELECT count(*) FROM safe_users u WHERE u.status_class='active' AND u.permission_values ? p.permission) AS stored_active_accounts
  FROM relevant_permissions p
), module_scopes AS (
  SELECT module,
    CASE WHEN data_scope_values->>module IN ('all','assigned','selected') THEN data_scope_values->>module
      WHEN NOT(data_scope_values ? module) THEN 'missing' ELSE 'unrecognized' END AS stored_scope,count(*) AS accounts
  FROM safe_users CROSS JOIN (VALUES ('knowledge'),('monitor'),('records'),('tickets'),('orders'),('shops')) m(module)
  GROUP BY 1,2
), installations AS MATERIALIZED (
  SELECT i.shop_id,i.shop_domain,i.installed_at,i.updated_at,
    regexp_split_to_array(lower(btrim(i.scope)), '[,[:space:]]+') AS scopes,
    btrim(i.scope)='' AS empty_scopes,
    s.id IS NOT NULL AS mapped_shop, s.status='active' AS active_shop,
    p.shop_id IS NOT NULL AS profile_exists,
    lower(btrim(p.shop_domain))=lower(btrim(i.shop_domain)) AS profile_domain_matches
  FROM public.shopify_installations i
  LEFT JOIN public.shops s ON s.id=i.shop_id
  LEFT JOIN public.shopify_app_profiles p ON p.shop_id=i.shop_id
), relevant_scopes(scope) AS (
  VALUES ('read_orders'),('write_orders'),('read_all_orders'),('read_customers'),('write_customers'),
    ('read_products'),('write_products'),('read_inventory'),('write_inventory'),('read_locations'),
    ('write_order_edits'),('read_returns'),('write_returns'),('read_fulfillments'),('write_fulfillments'),
    ('read_assigned_fulfillment_orders'),('write_assigned_fulfillment_orders'),
    ('read_merchant_managed_fulfillment_orders'),('write_merchant_managed_fulfillment_orders'),
    ('read_third_party_fulfillment_orders'),('write_third_party_fulfillment_orders'),('read_shopify_payments_disputes')
), scope_counts AS (
  SELECT scope,
    (SELECT count(*) FROM installations i WHERE s.scope=ANY(i.scopes)) AS saved_installations,
    (SELECT count(*) FROM installations i WHERE i.active_shop AND s.scope=ANY(i.scopes)) AS saved_active_shop_installations
  FROM relevant_scopes s
)
SELECT jsonb_build_object(
  'format','native-cs-access-summary-v1','observedAt',transaction_timestamp(),
  'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
  'productionReady',false,'shopifyApiCalled',false,'credentialsRead',false,'sessionRecordsRead',false,
  'users',(SELECT jsonb_build_object('total',count(*),
    'invalidPermissionShape',count(*) FILTER(WHERE permissions_array IS DISTINCT FROM true),
    'invalidDataScopeShape',count(*) FILTER(WHERE data_scopes_object IS DISTINCT FROM true),
    'invalidSelectedShopShape',count(*) FILTER(WHERE selected_shop_count IS NULL),
    'accountsWithSelectedShops',count(*) FILTER(WHERE selected_shop_count>0)) FROM safe_users),
  'userGroups',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY role_class,status_class,system_admin,permissions_customized,department_class,shop_scope_class,workbench_scope_class),'[]') FROM user_groups g),
  'storedPermissionCounts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY permission) FROM permission_counts p),
  'storedModuleScopes',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY module,stored_scope),'[]') FROM module_scopes m),
  'shopAssignments',(SELECT jsonb_build_object('links',count(*),'accounts',count(DISTINCT user_id),'shops',count(DISTINCT shop_id)) FROM public.shop_agents),
  'legacyIdentityLinks',(SELECT jsonb_build_object('links',count(*),'accounts',count(DISTINCT user_id)) FROM public.one_identity_links),
  'installations',(SELECT jsonb_build_object('total',count(*),'activeShop',count(*) FILTER(WHERE active_shop),
    'unmappedShop',count(*) FILTER(WHERE NOT mapped_shop),'emptySavedScopes',count(*) FILTER(WHERE empty_scopes),
    'missingAppProfile',count(*) FILTER(WHERE NOT profile_exists),
    'profileDomainMismatch',count(*) FILTER(WHERE profile_exists AND profile_domain_matches IS DISTINCT FROM true),
    'oldestStoredUpdate',min(updated_at),'newestStoredUpdate',max(updated_at)) FROM installations),
  'savedScopeCounts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY scope) FROM scope_counts s),
  'duplicateInstallationDomainGroups',(SELECT count(*) FROM (SELECT lower(btrim(shop_domain)) FROM installations GROUP BY 1 HAVING count(*)>1) d),
  'duplicateInstallationShopGroups',(SELECT count(*) FROM (SELECT shop_id FROM installations GROUP BY 1 HAVING count(*)>1) d)
);
ROLLBACK;
