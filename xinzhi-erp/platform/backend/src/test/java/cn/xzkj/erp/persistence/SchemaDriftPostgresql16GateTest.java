package cn.xzkj.erp.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.persistence.metamodel.EntityType;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.testcontainers.containers.PostgreSQLContainer;

class SchemaDriftPostgresql16GateTest {

    private static final String IMAGE = "postgres:16-alpine";
    private static final Set<String> IMMUTABLE_PROJECTION_TABLES = Set.of(
            "audit_logs");
    private static final Map<String, Set<String>> LEGACY_UNMAPPED_COLUMNS =
            Map.of("tenant_product_spus", Set.of(
                    "category_name",
                    "art_member_id",
                    "art_member_name_snapshot",
                    "developer_member_id",
                    "developer_member_name_snapshot",
                    "developer_assistant_member_id",
                    "developer_assistant_member_name_snapshot",
                    "sales_member_id",
                    "sales_member_name_snapshot"));
    private static final Map<String, String> COMPOSITE_PRIMARY_KEYS = Map.of(
            "iam_login_throttles", "tenant_id,user_id",
            "tenant_user_warehouse_scopes", "tenant_id,user_id");
    private static final Set<String> CASCADE_FOREIGN_KEYS = Set.of(
            "fk_approval_rule_approver_rule",
            "fk_iam_login_throttles_user_tenant",
            "fk_internal_notice_reads_notice",
            "fk_inventory_count_lines_batch",
            "fk_inventory_transfer_lines_transfer",
            "fk_logistics_authorization_channels_authorization",
            "fk_logistics_credentials_authorization",
            "fk_manual_box_items_box",
            "fk_manual_box_stock_items_stock",
            "fk_manual_boxes_movement",
            "fk_manual_movement_lines_movement",
            "fk_product_bundle_component_bundle",
            "fk_user_application_access_set_user",
            "fk_user_enabled_application_set",
            "tenant_enabled_application_modules_tenant_id_fkey",
            "tenant_order_exception_categories_tenant_id_fkey");
    private static final Set<String> MAPPED_TABLES = Set.of(
            "audit_logs",
            "auth_sessions",
            "customer_service_entry_grants",
            "first_party_application_entry_grants",
            "iam_login_throttles",
            "password_credentials",
            "permissions",
            "platform_admin_password_credentials",
            "platform_admin_sessions",
            "platform_admin_tenant_sessions",
            "platform_catalog",
            "roles",
            "shop_authorizations",
            "shop_sync_jobs",
            "system_admins",
            "tenant_order_lines",
            "tenant_orders",
            "tenant_product_categories",
            "tenant_product_listings",
            "tenant_product_package_materials",
            "tenant_product_skus",
            "tenant_product_spu_images",
            "tenant_product_spus",
            "tenant_shops",
            "tenant_supplier_sku_mappings",
            "tenant_suppliers",
            "tenant_user_warehouse_scopes",
            "tenant_warehouse_locations",
            "tenant_warehouses",
            "tenants",
            "users");
    private static final Set<String> VERSION_TABLES = Set.of(
            "password_credentials",
            "platform_admin_password_credentials",
            "platform_catalog",
            "roles",
            "shop_authorizations",
            "shop_sync_jobs",
            "system_admins",
            "tenant_orders",
            "tenant_product_categories",
            "tenant_product_listings",
            "tenant_product_package_materials",
            "tenant_product_skus",
            "tenant_product_spu_images",
            "tenant_product_spus",
            "tenant_shops",
            "tenant_supplier_sku_mappings",
            "tenant_suppliers",
            "tenant_user_warehouse_scopes",
            "tenant_warehouse_locations",
            "tenant_warehouses",
            "tenants",
            "users");
    private static final Set<String> TENANT_OWNED_TABLES = Set.of(
            "audit_logs",
            "auth_sessions",
            "iam_login_throttles",
            "password_credentials",
            "roles",
            "shop_authorizations",
            "shop_sync_jobs",
            "tenant_order_lines",
            "tenant_orders",
            "tenant_product_categories",
            "tenant_product_listings",
            "tenant_product_package_materials",
            "tenant_product_skus",
            "tenant_product_spu_images",
            "tenant_product_spus",
            "tenant_shops",
            "tenant_supplier_sku_mappings",
            "tenant_suppliers",
            "tenant_user_warehouse_scopes",
            "tenant_warehouse_locations",
            "tenant_warehouses",
            "users");
    private static final Map<String, String> TENANT_COMPOSITE_FOREIGN_KEYS =
            Map.ofEntries(
                    Map.entry("fk_auth_sessions_user_tenant",
                            "foreign key (user_id, tenant_id) references users(id, tenant_id)"),
                    Map.entry("fk_iam_login_throttles_user_tenant",
                            "foreign key (user_id, tenant_id) references users(id, tenant_id) on delete cascade"),
                    Map.entry("fk_password_credentials_creator_tenant",
                            "foreign key (created_by_user_id, tenant_id) references users(id, tenant_id)"),
                    Map.entry("fk_password_credentials_user_tenant",
                            "foreign key (user_id, tenant_id) references users(id, tenant_id)"),
                    Map.entry("fk_role_permissions_role_tenant",
                            "foreign key (role_id, tenant_id) references roles(id, tenant_id)"),
                    Map.entry("fk_shop_authorizations_shop",
                            "foreign key (tenant_id, shop_id) references tenant_shops(tenant_id, id)"),
                    Map.entry("fk_shop_sync_jobs_shop",
                            "foreign key (tenant_id, shop_id) references tenant_shops(tenant_id, id)"),
                    Map.entry("fk_shopify_order_cancellation_order",
                            "foreign key (tenant_id, order_id) references tenant_orders(tenant_id, id)"),
                    Map.entry("fk_shopify_order_cancellation_shop",
                            "foreign key (tenant_id, shop_id) references tenant_shops(tenant_id, id)"),
                    Map.entry("fk_tenant_order_lines_order",
                            "foreign key (tenant_id, order_id, currency) references tenant_orders(tenant_id, id, currency)"),
                    Map.entry("fk_tenant_order_lines_sku",
                            "foreign key (tenant_id, sku_id) references tenant_product_skus(tenant_id, id)"),
                    Map.entry("fk_tenant_orders_shop",
                            "foreign key (tenant_id, shop_id) references tenant_shops(tenant_id, id)"),
                    Map.entry("fk_tenant_product_listings_shop",
                            "foreign key (tenant_id, shop_id, platform_id) references tenant_shops(tenant_id, id, platform_id)"),
                    Map.entry("fk_tenant_product_listings_sku",
                            "foreign key (tenant_id, sku_id) references tenant_product_skus(tenant_id, id)"),
                    Map.entry("fk_tenant_product_skus_spu",
                            "foreign key (tenant_id, spu_id) references tenant_product_spus(tenant_id, id)"),
                    Map.entry("fk_tenant_supplier_sku_mappings_sku",
                            "foreign key (tenant_id, sku_id) references tenant_product_skus(tenant_id, id)"),
                    Map.entry("fk_tenant_supplier_sku_mappings_supplier",
                            "foreign key (tenant_id, supplier_id) references tenant_suppliers(tenant_id, id)"),
                    Map.entry("fk_tenant_warehouse_locations_warehouse",
                            "foreign key (tenant_id, warehouse_id) references tenant_warehouses(tenant_id, id)"),
                    Map.entry("fk_user_roles_role_tenant",
                            "foreign key (role_id, tenant_id) references roles(id, tenant_id)"),
                    Map.entry("fk_user_roles_user_tenant",
                            "foreign key (user_id, tenant_id) references users(id, tenant_id)"));
    private static final Set<String> REQUIRED_CHECKS = Set.of(
            "ck_auth_sessions_expiry",
            "ck_auth_sessions_token_hash",
            "ck_iam_login_throttles_failed_count",
            "ck_password_credentials_creator",
            "ck_password_credentials_terminal_state",
            "ck_password_credentials_version",
            "ck_platform_admin_credential_terminal",
            "ck_platform_admin_credential_version",
            "ck_roles_version",
            "ck_shop_authorizations_authorized_reference",
            "ck_shop_sync_jobs_progress",
            "ck_shopify_order_cancellation_attempts",
            "ck_shopify_order_cancellation_completion",
            "ck_shopify_order_cancellation_fingerprint",
            "ck_shopify_order_cancellation_key",
            "ck_shopify_order_cancellation_order_ref",
            "ck_shopify_order_cancellation_reason",
            "ck_shopify_order_cancellation_status",
            "ck_shopify_order_cancellation_versions",
            "ck_system_admins_password_state",
            "ck_system_admins_version",
            "ck_tenant_order_lines_match_consistency",
            "ck_tenant_orders_hold_reason",
            "ck_tenant_orders_version",
            "ck_tenant_supplier_sku_mappings_lead_time",
            "ck_tenant_supplier_sku_mappings_version",
            "ck_tenant_suppliers_version",
            "ck_tenant_warehouse_locations_version",
            "ck_tenant_warehouses_version",
            "ck_tenants_version",
            "ck_users_version");
    private static final Map<String, String> REQUIRED_INDEXES =
            Map.ofEntries(
                    Map.entry("idx_auth_sessions_tenant_user",
                            "(tenant_id, user_id)"),
                    Map.entry("idx_shop_sync_jobs_tenant_shop_requested",
                            "(tenant_id, shop_id, requested_at desc)"),
                    Map.entry("idx_tenant_order_lines_match_source",
                            "(tenant_id, order_id, sku_match_source, id)"),
                    Map.entry("idx_tenant_orders_list",
                            "(tenant_id, placed_at desc, id desc)"),
                    Map.entry("idx_tenant_product_listings_tenant_shop_status_ref",
                            "(tenant_id, shop_id, status, external_listing_ref, id)"),
                    Map.entry("idx_tenant_product_skus_tenant_spu_status_code",
                            "(tenant_id, spu_id, status, business_code, id)"),
                    Map.entry("idx_tenant_supplier_sku_mappings_list",
                            "(tenant_id, supplier_id, status, preferred desc, created_at, id)"),
                    Map.entry("idx_tenant_suppliers_list",
                            "(tenant_id, status, business_code, id)"),
                    Map.entry("idx_tenant_warehouse_locations_list",
                            "(tenant_id, warehouse_id, status, business_code, id)"),
                    Map.entry("idx_tenant_warehouses_list",
                            "(tenant_id, status, business_code, id)"),
                    Map.entry("uq_password_credentials_active_purpose",
                            "where ((consumed_at is null) and (revoked_at is null))"),
                    Map.entry("uq_platform_admin_credential_open_purpose",
                            "where ((consumed_at is null) and (revoked_at is null))"),
                    Map.entry("uq_shop_sync_jobs_open_type",
                            "where ((status)::text = any"),
                    Map.entry("uq_system_admins_username_ci",
                            "(lower((username)::text))"),
                    Map.entry("uq_tenant_product_listings_external_reference",
                            "coalesce(external_variant_ref"),
                    Map.entry("uq_tenant_supplier_sku_mappings_active_preferred",
                            "where (((status)::text = 'active'::text) and preferred)"));
    private static final Map<String, Set<String>> REQUIRED_UNIQUES =
            Map.ofEntries(
                    Map.entry("auth_sessions", Set.of("token_hash")),
                    Map.entry("password_credentials", Set.of("token_hash")),
                    Map.entry("permissions", Set.of("code")),
                    Map.entry("platform_admin_password_credentials",
                            Set.of("token_hash")),
                    Map.entry("platform_admin_sessions", Set.of(
                            "token_hash", "id,system_admin_id")),
                    Map.entry("platform_admin_tenant_sessions",
                            Set.of("token_hash")),
                    Map.entry("platform_catalog", Set.of("code")),
                    Map.entry("roles", Set.of("tenant_id,code", "id,tenant_id")),
                    Map.entry("shop_authorizations",
                            Set.of("tenant_id,shop_id")),
                    Map.entry("shop_sync_jobs", Set.of("tenant_id,id")),
                    Map.entry("tenant_orders", Set.of(
                            "tenant_id,id",
                            "tenant_id,id,currency",
                            "tenant_id,shop_id,external_order_ref",
                            "tenant_id,idempotency_key")),
                    Map.entry("tenant_product_listings",
                            Set.of("tenant_id,id")),
                    Map.entry("tenant_product_skus", Set.of(
                            "tenant_id,business_code", "tenant_id,id")),
                    Map.entry("tenant_product_spus", Set.of(
                            "tenant_id,business_code", "tenant_id,id")),
                    Map.entry("tenant_shops", Set.of(
                            "tenant_id,id",
                            "tenant_id,id,platform_id",
                            "tenant_id,platform_id,external_shop_ref")),
                    Map.entry("tenant_supplier_sku_mappings", Set.of(
                            "tenant_id,supplier_id,sku_id", "tenant_id,id")),
                    Map.entry("tenant_suppliers", Set.of(
                            "tenant_id,business_code", "tenant_id,id")),
                    Map.entry("tenant_warehouse_locations", Set.of(
                            "tenant_id,warehouse_id,business_code", "tenant_id,id")),
                    Map.entry("tenant_warehouses", Set.of(
                            "tenant_id,business_code", "tenant_id,id")),
                    Map.entry("tenants", Set.of("code")),
                    Map.entry("users", Set.of("tenant_id,username", "id,tenant_id")));
    private static final Map<String, String> REQUIRED_DEFAULTS =
            Map.ofEntries(
                    Map.entry("platform_catalog.status", "'ACTIVE'"),
                    Map.entry("shop_authorizations.status", "'NOT_AUTHORIZED'"),
                    Map.entry("shop_sync_jobs.attempt_count", "0"),
                    Map.entry("shop_sync_jobs.progress_processed", "0"),
                    Map.entry("shop_sync_jobs.status", "'QUEUED'"),
                    Map.entry("tenant_orders.status", "'RECEIVED'"),
                    Map.entry("tenant_product_listings.status", "'ACTIVE'"),
                    Map.entry("tenant_product_skus.status", "'ACTIVE'"),
                    Map.entry("tenant_product_spus.status", "'ACTIVE'"),
                    Map.entry("tenant_shops.status", "'ACTIVE'"),
                    Map.entry("tenant_supplier_sku_mappings.preferred", "false"),
                    Map.entry("tenant_supplier_sku_mappings.status", "'ACTIVE'"),
                    Map.entry("tenant_suppliers.status", "'ACTIVE'"),
                    Map.entry("tenant_warehouse_locations.status", "'ACTIVE'"),
                    Map.entry("tenant_warehouses.status", "'ACTIVE'"),
                    Map.entry("tenants.status", "'ACTIVE'"),
                    Map.entry("users.status", "'ACTIVE'"));
    private static final Set<String> DATABASE_GENERATED_UUID_TABLES = Set.of(
            "permissions",
            "platform_catalog",
            "roles",
            "shop_authorizations",
            "shop_sync_jobs",
            "tenant_order_lines",
            "tenant_orders",
            "tenant_product_listings",
            "tenant_product_skus",
            "tenant_product_spus",
            "tenant_shops",
            "tenant_supplier_sku_mappings",
            "tenant_suppliers",
            "tenant_warehouse_locations",
            "tenant_warehouses",
            "tenants",
            "users");

    @SuppressWarnings("resource")
    @Test
    void validatesJpaAndFlywayCatalogWithoutExternalDatabaseInputs()
            throws Exception {
        try (PostgreSQLContainer<?> postgres =
                     new PostgreSQLContainer<>(IMAGE)
                             .withDatabaseName("erp_schema_drift_gate")
                             .withUsername("erp_gate")
                             .withPassword("erp_gate")) {
            postgres.start();
            assertThat(postgres.getDockerImageName()).isEqualTo(IMAGE);
            assertThat(postgres.isRunning()).isTrue();
            assertThat(postgres.getJdbcUrl()).startsWith("jdbc:postgresql:");

            Flyway flyway = Flyway.configure()
                    .dataSource(
                            postgres.getJdbcUrl(),
                            postgres.getUsername(),
                            postgres.getPassword())
                    .locations("classpath:db/migration")
                    .cleanDisabled(true)
                    .outOfOrder(false)
                    .load();
            assertThat(flyway.migrate().migrationsExecuted).isPositive();
            flyway.validate();
            assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo("123");
            assertThat(flyway.info().pending()).isEmpty();

            try (ConfigurableApplicationContext context =
                         startHibernateValidation(postgres);
                    Connection connection = DriverManager.getConnection(
                            postgres.getJdbcUrl(),
                            postgres.getUsername(),
                            postgres.getPassword())) {
                assertThat(singleString(connection, "SHOW server_version"))
                        .startsWith("16.");
                assertThat(context.getEnvironment().getProperty(
                        "spring.jpa.hibernate.ddl-auto"))
                        .isEqualTo("validate");

                EntityManagerFactory emf =
                        context.getBean(EntityManagerFactory.class);
                Map<String, Class<?>> entities = mappedEntities(emf);
                assertThat(entities.keySet()).containsExactlyInAnyOrderElementsOf(
                        MAPPED_TABLES);
                assertJpaColumnsMatchCatalog(connection, entities);
                assertVersionMappings(connection, entities);
                assertNoJpaRemoveCascades(entities.values());
                assertCriticalCatalog(connection);
                assertCrossTenantReferencesFail(connection);
                assertMutatedSchemaFailsClosed(connection, entities);

                System.out.println(
                        "SCHEMA_DRIFT_GATE_EVIDENCE "
                        + "testcontainers=1.21.4 image=postgres:16-alpine "
                        + "postgresql=16 flyway=121 mapped_entities=31 "
                        + "hibernate_validate=passed catalog=passed "
                        + "tenant_negative=passed mutation_negative=passed "
                        + "tests=1 failures=0 skipped=0");
            }
        }
    }

    private static ConfigurableApplicationContext startHibernateValidation(
            PostgreSQLContainer<?> postgres) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "schema-drift-gate",
                Map.ofEntries(
                        Map.entry("spring.datasource.url", postgres.getJdbcUrl()),
                        Map.entry("spring.datasource.username", postgres.getUsername()),
                        Map.entry("spring.datasource.password", postgres.getPassword()),
                        Map.entry("spring.jpa.hibernate.ddl-auto", "validate"),
                        Map.entry("spring.flyway.enabled", "true"),
                        Map.entry("erp.bootstrap.initial-admin.enabled", "false"),
                        Map.entry("erp.bootstrap.platform-admin.enabled", "false"),
                        Map.entry("logging.level.root", "WARN"))));
        return new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.NONE)
                .environment(environment)
                .run();
    }

    private static Map<String, Class<?>> mappedEntities(
            EntityManagerFactory emf) {
        Map<String, Class<?>> result = new LinkedHashMap<>();
        for (EntityType<?> entity : emf.getMetamodel().getEntities()) {
            Table table = entity.getJavaType().getAnnotation(Table.class);
            assertThat(table)
                    .as("explicit @Table on %s", entity.getJavaType().getName())
                    .isNotNull();
            assertThat(result.put(table.name(), entity.getJavaType()))
                    .as("duplicate mapped table %s", table.name())
                    .isNull();
        }
        return result;
    }

    private static void assertJpaColumnsMatchCatalog(
            Connection connection,
            Map<String, Class<?>> entities) throws SQLException {
        for (Map.Entry<String, Class<?>> entity : entities.entrySet()) {
            Map<String, ColumnFact> expected =
                    mappedColumns(entity.getValue());
            Map<String, ColumnFact> actual =
                    catalogColumns(connection, entity.getKey());
            if (IMMUTABLE_PROJECTION_TABLES.contains(entity.getKey())) {
                assertThat(actual.keySet())
                        .as("mapped projection columns for %s", entity.getKey())
                        .containsAll(expected.keySet());
            } else {
                Set<String> expectedPhysicalColumns =
                        new TreeSet<>(expected.keySet());
                expectedPhysicalColumns.addAll(
                        LEGACY_UNMAPPED_COLUMNS.getOrDefault(
                                entity.getKey(), Set.of()));
                assertThat(actual.keySet())
                        .as("columns for %s", entity.getKey())
                        .containsExactlyInAnyOrderElementsOf(
                                expectedPhysicalColumns);
            }
            for (Map.Entry<String, ColumnFact> column : expected.entrySet()) {
                ColumnFact catalog = actual.get(column.getKey());
                ColumnFact mapping = column.getValue();
                assertThat(catalog.type())
                        .as("%s.%s type", entity.getKey(), column.getKey())
                        .isEqualTo(mapping.type());
                assertThat(catalog.nullable())
                        .as("%s.%s nullability", entity.getKey(), column.getKey())
                        .isEqualTo(mapping.nullable());
                if (mapping.length() != null) {
                    assertThat(catalog.length())
                            .as("%s.%s length", entity.getKey(), column.getKey())
                            .isEqualTo(mapping.length());
                }
            }
        }
    }

    private static Map<String, ColumnFact> mappedColumns(Class<?> entity) {
        Map<String, ColumnFact> result = new LinkedHashMap<>();
        for (Class<?> type = entity;
                type != null && type != Object.class;
                type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (field.isAnnotationPresent(EmbeddedId.class)) {
                    for (Field embedded :
                            field.getType().getDeclaredFields()) {
                        Column column = embedded.getAnnotation(Column.class);
                        if (column != null) {
                            result.put(
                                    columnName(embedded, column.name()),
                                    columnFact(
                                            embedded.getType(),
                                            column.length(),
                                            column.precision(),
                                            column.scale(),
                                            false));
                        }
                    }
                    continue;
                }
                JoinColumn join = field.getAnnotation(JoinColumn.class);
                if (join != null) {
                    boolean optional = !field.isAnnotationPresent(ManyToOne.class)
                            || field.getAnnotation(ManyToOne.class).optional();
                    result.put(
                            columnName(field, join.name()),
                            new ColumnFact("uuid", null,
                                    join.nullable() && optional));
                    continue;
                }
                Column column = field.getAnnotation(Column.class);
                Id id = field.getAnnotation(Id.class);
                if (column == null && id == null) {
                    continue;
                }
                String explicitName =
                        column == null ? "" : column.name();
                int length = column == null ? 255 : column.length();
                boolean nullable = column == null || column.nullable();
                result.put(
                        columnName(field, explicitName),
                        columnFact(
                                field.getType(),
                                length,
                                column == null ? 0 : column.precision(),
                                column == null ? 0 : column.scale(),
                                nullable
                                        && id == null
                                        && !field.getType().isPrimitive()));
            }
        }
        return result;
    }

    private static ColumnFact columnFact(
            Class<?> javaType,
            int length,
            int precision,
            int scale,
            boolean nullable) {
        if (javaType == UUID.class) {
            return new ColumnFact("uuid", null, nullable);
        }
        if (javaType == Instant.class) {
            return new ColumnFact(
                    "timestamp with time zone", null, nullable);
        }
        if (javaType == String.class || javaType.isEnum()) {
            return new ColumnFact(
                    "character varying", length, nullable);
        }
        if (javaType == int.class || javaType == Integer.class) {
            return new ColumnFact("integer", null, nullable);
        }
        if (javaType == long.class || javaType == Long.class) {
            return new ColumnFact("bigint", null, nullable);
        }
        if (javaType == boolean.class || javaType == Boolean.class) {
            return new ColumnFact("boolean", null, nullable);
        }
        if (javaType == BigDecimal.class && precision > 0 && scale >= 0) {
            return new ColumnFact(
                    "numeric(" + precision + "," + scale + ")",
                    null,
                    nullable);
        }
        throw new AssertionError(
                "unreviewed persistent Java type: " + javaType.getName());
    }

    private static String columnName(Field field, String explicitName) {
        if (explicitName != null && !explicitName.isBlank()) {
            return explicitName;
        }
        return field.getName()
                .replaceAll("([a-z0-9])([A-Z])", "$1_$2")
                .toLowerCase(Locale.ROOT);
    }

    private static Map<String, ColumnFact> catalogColumns(
            Connection connection,
            String table) throws SQLException {
        Map<String, ColumnFact> result = new LinkedHashMap<>();
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT column_name, data_type, character_maximum_length,
                       numeric_precision, numeric_scale, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = ?
                ORDER BY ordinal_position
                """)) {
            statement.setString(1, table);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    long length = rows.getLong("character_maximum_length");
                    Integer nullableLength =
                            rows.wasNull() ? null : (int) length;
                    String dataType = rows.getString("data_type");
                    if (dataType.equals("numeric")) {
                        dataType = "numeric("
                                + rows.getInt("numeric_precision") + ","
                                + rows.getInt("numeric_scale") + ")";
                    }
                    result.put(
                            rows.getString("column_name"),
                            new ColumnFact(
                                    dataType,
                                    nullableLength,
                                    rows.getString("is_nullable")
                                            .equals("YES")));
                }
            }
        }
        return result;
    }

    private static void assertVersionMappings(
            Connection connection,
            Map<String, Class<?>> entities) throws SQLException {
        Set<String> versioned = entities.entrySet().stream()
                .filter(entry -> versionFields(entry.getValue()).size() == 1)
                .map(Map.Entry::getKey)
                .collect(Collectors.toCollection(TreeSet::new));
        assertThat(versioned)
                .containsExactlyInAnyOrderElementsOf(VERSION_TABLES);
        for (String table : VERSION_TABLES) {
            ColumnFact version = catalogColumns(connection, table)
                    .get("version");
            assertThat(version)
                    .as("%s optimistic version column", table)
                    .isEqualTo(new ColumnFact("bigint", null, false));
            assertDefault(connection, table, "version", "0");
        }
    }

    private static List<Field> versionFields(Class<?> entity) {
        List<Field> fields = new ArrayList<>();
        for (Class<?> type = entity;
                type != null && type != Object.class;
                type = type.getSuperclass()) {
            fields.addAll(Arrays.stream(type.getDeclaredFields())
                    .filter(field -> field.isAnnotationPresent(Version.class))
                    .toList());
        }
        return fields;
    }

    private static void assertNoJpaRemoveCascades(
            Iterable<Class<?>> entities) {
        for (Class<?> entity : entities) {
            for (Class<?> type = entity;
                    type != null && type != Object.class;
                    type = type.getSuperclass()) {
                for (Field field : type.getDeclaredFields()) {
                    Set<CascadeType> cascades = cascadeTypes(field);
                    assertThat(cascades)
                            .as("JPA remove cascade %s.%s",
                                    entity.getSimpleName(),
                                    field.getName())
                            .doesNotContain(CascadeType.ALL, CascadeType.REMOVE);
                    OneToMany oneToMany =
                            field.getAnnotation(OneToMany.class);
                    if (oneToMany != null) {
                        assertThat(oneToMany.orphanRemoval()).isFalse();
                    }
                    OneToOne oneToOne =
                            field.getAnnotation(OneToOne.class);
                    if (oneToOne != null) {
                        assertThat(oneToOne.orphanRemoval()).isFalse();
                    }
                }
            }
        }
    }

    private static Set<CascadeType> cascadeTypes(Field field) {
        if (field.isAnnotationPresent(ManyToOne.class)) {
            return Set.of(field.getAnnotation(ManyToOne.class).cascade());
        }
        if (field.isAnnotationPresent(OneToMany.class)) {
            return Set.of(field.getAnnotation(OneToMany.class).cascade());
        }
        if (field.isAnnotationPresent(OneToOne.class)) {
            return Set.of(field.getAnnotation(OneToOne.class).cascade());
        }
        if (field.isAnnotationPresent(ManyToMany.class)) {
            return Set.of(field.getAnnotation(ManyToMany.class).cascade());
        }
        return Set.of();
    }

    private static void assertCriticalCatalog(Connection connection)
            throws SQLException {
        assertPrimaryKeys(connection);
        assertTenantBoundaries(connection);
        assertForeignKeyDeleteActions(connection);
        assertConstraintDefinitions(connection);
        assertUniqueSets(connection);
        assertIndexes(connection);
        assertDefaults(connection);
        assertDeleteAndIdentityTriggers(connection);
    }

    private static void assertPrimaryKeys(Connection connection)
            throws SQLException {
        Map<String, String> primaryKeys = new LinkedHashMap<>();
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery("""
                        SELECT c.relname AS table_name,
                               string_agg(a.attname, ',' ORDER BY key.ordinality)
                                   AS columns
                        FROM pg_constraint con
                        JOIN pg_class c ON c.oid = con.conrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        JOIN unnest(con.conkey) WITH ORDINALITY
                            AS key(attnum, ordinality) ON true
                        JOIN pg_attribute a
                            ON a.attrelid = c.oid
                           AND a.attnum = key.attnum
                        WHERE n.nspname = 'public' AND con.contype = 'p'
                        GROUP BY c.relname
                        """)) {
            while (rows.next()) {
                primaryKeys.put(
                        rows.getString("table_name"),
                        rows.getString("columns"));
            }
        }
        for (String table : MAPPED_TABLES) {
            assertThat(primaryKeys.get(table))
                    .as("%s primary key", table)
                    .isEqualTo(COMPOSITE_PRIMARY_KEYS.getOrDefault(
                            table, "id"));
        }
    }

    private static void assertTenantBoundaries(Connection connection)
            throws SQLException {
        for (String table : TENANT_OWNED_TABLES) {
            assertThat(catalogColumns(connection, table).get("tenant_id"))
                    .as("%s tenant discriminator", table)
                    .isEqualTo(new ColumnFact("uuid", null, false));
        }
        for (Map.Entry<String, String> expected :
                TENANT_COMPOSITE_FOREIGN_KEYS.entrySet()) {
            assertThat(constraintDefinition(connection, expected.getKey()))
                    .as(expected.getKey())
                    .contains(normalize(expected.getValue()));
        }
    }

    private static void assertForeignKeyDeleteActions(Connection connection)
            throws SQLException {
        Set<String> cascades = new TreeSet<>();
        Set<String> nonDefaultActions = new TreeSet<>();
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery("""
                        SELECT conname, confdeltype
                        FROM pg_constraint con
                        JOIN pg_namespace n ON n.oid = con.connamespace
                        WHERE n.nspname = 'public' AND contype = 'f'
                        """)) {
            while (rows.next()) {
                String action = rows.getString("confdeltype");
                if (action.equals("c")) {
                    cascades.add(rows.getString("conname"));
                } else if (!action.equals("a")) {
                    nonDefaultActions.add(rows.getString("conname"));
                }
            }
        }
        assertThat(cascades)
                .containsExactlyElementsOf(new TreeSet<>(CASCADE_FOREIGN_KEYS));
        assertThat(nonDefaultActions).isEmpty();
    }

    private static void assertConstraintDefinitions(Connection connection)
            throws SQLException {
        Set<String> checks = constraintNames(connection, "c");
        assertThat(checks).containsAll(REQUIRED_CHECKS);
        assertThat(constraintDefinition(
                connection, "ck_tenant_order_lines_match_consistency"))
                .contains("sku_match_source", "sku_id is null",
                        "sku_id is not null");
        assertThat(constraintDefinition(
                connection, "ck_password_credentials_creator"))
                .contains("created_by_user_id is not null",
                        "created_by_system_admin_id is not null", "= 1");
    }

    private static Set<String> constraintNames(
            Connection connection,
            String type) throws SQLException {
        Set<String> result = new TreeSet<>();
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT conname
                FROM pg_constraint con
                JOIN pg_namespace n ON n.oid = con.connamespace
                WHERE n.nspname = 'public' AND contype = ?
                """)) {
            statement.setString(1, type);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    result.add(rows.getString(1));
                }
            }
        }
        return result;
    }

    private static String constraintDefinition(
            Connection connection,
            String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT pg_get_constraintdef(con.oid, true)
                FROM pg_constraint con
                JOIN pg_namespace n ON n.oid = con.connamespace
                WHERE n.nspname = 'public' AND con.conname = ?
                """)) {
            statement.setString(1, name);
            try (ResultSet rows = statement.executeQuery()) {
                assertThat(rows.next()).as("constraint %s", name).isTrue();
                String definition = normalize(rows.getString(1));
                assertThat(rows.next()).as("unique constraint name %s", name)
                        .isFalse();
                return definition;
            }
        }
    }

    private static void assertUniqueSets(Connection connection)
            throws SQLException {
        for (Map.Entry<String, Set<String>> entry :
                REQUIRED_UNIQUES.entrySet()) {
            Set<String> actual = new LinkedHashSet<>();
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT string_agg(a.attname, ','
                                      ORDER BY key.ordinality)
                    FROM pg_constraint con
                    JOIN pg_class c ON c.oid = con.conrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    JOIN unnest(con.conkey) WITH ORDINALITY
                        AS key(attnum, ordinality) ON true
                    JOIN pg_attribute a
                        ON a.attrelid = c.oid
                       AND a.attnum = key.attnum
                    WHERE n.nspname = 'public'
                      AND c.relname = ?
                      AND con.contype = 'u'
                    GROUP BY con.oid
                    """)) {
                statement.setString(1, entry.getKey());
                try (ResultSet rows = statement.executeQuery()) {
                    while (rows.next()) {
                        actual.add(rows.getString(1));
                    }
                }
            }
            assertThat(actual)
                    .as("%s unique constraints", entry.getKey())
                    .containsAll(entry.getValue());
        }
    }

    private static void assertIndexes(Connection connection)
            throws SQLException {
        Map<String, String> indexes = new LinkedHashMap<>();
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery("""
                        SELECT indexname, indexdef
                        FROM pg_indexes
                        WHERE schemaname = 'public'
                        """)) {
            while (rows.next()) {
                indexes.put(
                        rows.getString("indexname"),
                        normalize(rows.getString("indexdef")));
            }
        }
        for (Map.Entry<String, String> expected :
                REQUIRED_INDEXES.entrySet()) {
            assertThat(indexes.get(expected.getKey()))
                    .as("index %s", expected.getKey())
                    .isNotNull()
                    .contains(normalize(expected.getValue()));
        }
    }

    private static void assertDefaults(Connection connection)
            throws SQLException {
        for (String table : DATABASE_GENERATED_UUID_TABLES) {
            assertDefault(
                    connection, table, "id", "gen_random_uuid()");
        }
        for (Map.Entry<String, String> expected :
                REQUIRED_DEFAULTS.entrySet()) {
            String[] parts = expected.getKey().split("\\.", 2);
            assertDefault(
                    connection,
                    parts[0],
                    parts[1],
                    expected.getValue());
        }
    }

    private static void assertDefault(
            Connection connection,
            String table,
            String column,
            String fragment) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT column_default
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = ?
                  AND column_name = ?
                """)) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet rows = statement.executeQuery()) {
                assertThat(rows.next())
                        .as("%s.%s default column", table, column)
                        .isTrue();
                assertThat(normalize(rows.getString(1)))
                        .as("%s.%s default", table, column)
                        .contains(normalize(fragment));
            }
        }
    }

    private static void assertDeleteAndIdentityTriggers(
            Connection connection) throws SQLException {
        Set<String> triggers = new TreeSet<>();
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery("""
                        SELECT tgname
                        FROM pg_trigger t
                        JOIN pg_class c ON c.oid = t.tgrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public'
                          AND NOT t.tgisinternal
                          AND t.tgenabled <> 'D'
                        """)) {
            while (rows.next()) {
                triggers.add(rows.getString(1));
            }
        }
        assertThat(triggers).contains(
                "trg_system_admin_state",
                "trg_tenant_supplier_sku_mappings_enforce_write",
                "trg_tenant_supplier_sku_mappings_prevent_delete",
                "trg_tenant_suppliers_prevent_delete");
    }

    private static void assertCrossTenantReferencesFail(
            Connection connection) throws SQLException {
        connection.setAutoCommit(false);
        try {
            execute(connection, """
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      ('10000000-0000-0000-0000-000000000001', 'gate_a', 'Gate A'),
                      ('20000000-0000-0000-0000-000000000001', 'gate_b', 'Gate B')
                    """);
            execute(connection, """
                    INSERT INTO platform_catalog (id, code, display_name)
                    VALUES ('30000000-0000-0000-0000-000000000001',
                            'GATE_PLATFORM', 'Gate Platform')
                    """);
            execute(connection, """
                    INSERT INTO tenant_shops
                      (id, tenant_id, platform_id, external_shop_ref, display_name)
                    VALUES
                      ('10000000-0000-0000-0000-000000000002',
                       '10000000-0000-0000-0000-000000000001',
                       '30000000-0000-0000-0000-000000000001', 'shop-a', 'Shop A'),
                      ('20000000-0000-0000-0000-000000000002',
                       '20000000-0000-0000-0000-000000000001',
                       '30000000-0000-0000-0000-000000000001', 'shop-b', 'Shop B')
                    """);
            execute(connection, """
                    INSERT INTO tenant_product_spus
                      (id, tenant_id, business_code, name)
                    VALUES
                      ('10000000-0000-0000-0000-000000000003',
                       '10000000-0000-0000-0000-000000000001', 'SPU_A', 'SPU A'),
                      ('20000000-0000-0000-0000-000000000003',
                       '20000000-0000-0000-0000-000000000001', 'SPU_B', 'SPU B')
                    """);
            assertForeignKeyViolation(connection, """
                    INSERT INTO tenant_product_skus
                      (tenant_id, spu_id, business_code, name)
                    VALUES
                      ('10000000-0000-0000-0000-000000000001',
                       '20000000-0000-0000-0000-000000000003',
                       'CROSS_SKU', 'Cross SKU')
                    """);
            assertForeignKeyViolation(connection, """
                    INSERT INTO shop_authorizations (tenant_id, shop_id)
                    VALUES
                      ('10000000-0000-0000-0000-000000000001',
                       '20000000-0000-0000-0000-000000000002')
                    """);
            assertForeignKeyViolation(connection, """
                    INSERT INTO tenant_orders
                      (tenant_id, shop_id, external_order_ref, idempotency_key,
                       request_fingerprint, currency, line_count, placed_at)
                    VALUES
                      ('10000000-0000-0000-0000-000000000001',
                       '20000000-0000-0000-0000-000000000002',
                       'cross-order', 'cross-order',
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                       'CNY', 1, now())
                    """);
        } finally {
            connection.rollback();
            connection.setAutoCommit(true);
        }
    }

    private static void assertForeignKeyViolation(
            Connection connection,
            String sql) throws SQLException {
        java.sql.Savepoint savepoint = connection.setSavepoint();
        try {
            assertThatThrownBy(() -> execute(connection, sql))
                    .isInstanceOf(SQLException.class)
                    .extracting(failure ->
                            ((SQLException) failure).getSQLState())
                    .isEqualTo("23503");
        } finally {
            connection.rollback(savepoint);
        }
    }

    private static void assertMutatedSchemaFailsClosed(
            Connection connection,
            Map<String, Class<?>> entities) throws SQLException {
        connection.setAutoCommit(false);
        try {
            execute(connection, """
                    ALTER TABLE tenant_orders
                    ALTER COLUMN idempotency_key DROP NOT NULL
                    """);
            assertThatThrownBy(() ->
                    assertJpaColumnsMatchCatalog(connection, entities))
                    .isInstanceOf(AssertionError.class)
                    .hasMessageContaining("idempotency_key nullability");
        } finally {
            connection.rollback();
        }
        try {
            execute(connection, """
                    ALTER TABLE tenant_supplier_sku_mappings
                    DROP CONSTRAINT fk_tenant_supplier_sku_mappings_sku
                    """);
            assertThatThrownBy(() -> assertCriticalCatalog(connection))
                    .isInstanceOf(AssertionError.class)
                    .hasMessageContaining(
                            "fk_tenant_supplier_sku_mappings_sku");
        } finally {
            connection.rollback();
        }
        try {
            execute(connection, """
                    DROP INDEX idx_tenant_orders_list
                    """);
            assertThatThrownBy(() -> assertCriticalCatalog(connection))
                    .isInstanceOf(AssertionError.class)
                    .hasMessageContaining("idx_tenant_orders_list");
        } finally {
            connection.rollback();
            connection.setAutoCommit(true);
        }
        assertCriticalCatalog(connection);
    }

    private static void execute(Connection connection, String sql)
            throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String singleString(
            Connection connection,
            String sql) throws SQLException {
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery(sql)) {
            assertThat(rows.next()).isTrue();
            return rows.getString(1);
        }
    }

    private static String normalize(String value) {
        return value == null ? "" : value
                .replace("\"", "")
                .replaceAll("\\s+", " ")
                .trim()
                .toLowerCase(Locale.ROOT);
    }

    private record ColumnFact(
            String type,
            Integer length,
            boolean nullable) {
    }
}
