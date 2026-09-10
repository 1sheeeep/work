package cn.xzkj.erp.product.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;

import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

class ProductMasterDataMigrationPostgresql16GateTest {

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void startPostgres16() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = System.getenv().getOrDefault(
                    "ERP_TEST_DB_USER",
                    "erp_test");
            password = System.getenv().getOrDefault(
                    "ERP_TEST_DB_PASSWORD",
                    "erp_test");
            return;
        }
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(imageName -> false)
                .withDatabaseName("erp_product_master_data_gate")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
    }

    @BeforeEach
    void cleanDatabase() {
        flyway().clean();
    }

    @AfterAll
    static void stopPostgres16() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void migratesEmptyPostgres16ThroughV45() throws Exception {
        Flyway flyway = flyway();
        flyway.migrate();

        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo("45");
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'tenant_product_spus'
                      AND column_name IN (
                        'name_zh', 'name_en', 'product_note',
                        'sensitive_attributes_revision'
                      )
                    """)).isEqualTo(4);
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'tenant_product_skus'
                      AND column_name IN (
                        'name_en', 'unit_cost', 'currency_code',
                        'default_warehouse_id',
                        'default_warehouse_name_snapshot'
                      )
                    """)).isEqualTo(5);
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name =
                        'tenant_product_spu_sensitive_attributes'
                    """)).isEqualTo(1);
        }
    }

    @Test
    void backfillsV30NameAndMovesLegacyDescriptionToProductNote()
            throws Exception {
        migrateToV30();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            insertLegacyTenantsAndSpus(statement);
        }

        flyway().migrate();

        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleString(statement, """
                    SELECT name || '|' || name_zh || '|'
                        || coalesce(product_note, '<null>') || '|'
                        || sensitive_attributes_revision
                    FROM tenant_product_spus
                    WHERE id =
                      '43000000-0000-0000-0000-000000000011'
                    """)).isEqualTo(
                    "V30 中文名称|V30 中文名称|V30 description|0");
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'tenant_product_spus'
                      AND column_name = 'description'
                    """)).isZero();

            statement.executeUpdate("""
                    UPDATE tenant_product_spus
                    SET name = 'Legacy client update'
                    WHERE id =
                      '43000000-0000-0000-0000-000000000011'
                    """);
            assertThat(singleString(statement, """
                    SELECT name || '|' || name_zh
                    FROM tenant_product_spus
                    WHERE id =
                      '43000000-0000-0000-0000-000000000011'
                    """)).isEqualTo(
                    "Legacy client update|Legacy client update");

            statement.executeUpdate("""
                    UPDATE tenant_product_spus
                    SET name_zh = 'V43 client update'
                    WHERE id =
                      '43000000-0000-0000-0000-000000000011'
                    """);
            assertThat(singleString(statement, """
                    SELECT name || '|' || name_zh
                    FROM tenant_product_spus
                    WHERE id =
                      '43000000-0000-0000-0000-000000000011'
                    """)).isEqualTo(
                    "V43 client update|V43 client update");
        }
    }

    @Test
    void rejectsCrossTenantUnknownDuplicateAndUnstableAttributes()
            throws Exception {
        flyway().migrate();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            insertV45TenantsAndSpus(statement);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_sensitive_attributes (
                        tenant_id, spu_id, attribute_code, sort_order
                    ) VALUES
                      ('43000000-0000-0000-0000-000000000001',
                       '43000000-0000-0000-0000-000000000011',
                       'FLAMMABLE', 9),
                      ('43000000-0000-0000-0000-000000000001',
                       '43000000-0000-0000-0000-000000000011',
                       'BATTERY', 0)
                    """);
            assertThat(singleString(statement, """
                    SELECT string_agg(attribute_code, ',' ORDER BY sort_order)
                    FROM tenant_product_spu_sensitive_attributes
                    WHERE tenant_id =
                      '43000000-0000-0000-0000-000000000001'
                      AND spu_id =
                      '43000000-0000-0000-0000-000000000011'
                    """)).isEqualTo("BATTERY,FLAMMABLE");

            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_sensitive_attributes (
                        tenant_id, spu_id, attribute_code, sort_order
                    ) VALUES (
                      '43000000-0000-0000-0000-000000000001',
                      '43000000-0000-0000-0000-000000000011',
                      'UNKNOWN', 2)
                    """)).hasMessageContaining(
                    "ck_tenant_product_spu_sensitive_attributes_code_order");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_sensitive_attributes (
                        tenant_id, spu_id, attribute_code, sort_order
                    ) VALUES (
                      '43000000-0000-0000-0000-000000000002',
                      '43000000-0000-0000-0000-000000000011',
                      'MAGNETIC', 2)
                    """)).hasMessageContaining(
                    "fk_tenant_product_spu_sensitive_attributes_spu");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_sensitive_attributes (
                        tenant_id, spu_id, attribute_code, sort_order
                    ) VALUES (
                      '43000000-0000-0000-0000-000000000001',
                      '43000000-0000-0000-0000-000000000011',
                      'BATTERY', 0)
                    """)).hasMessageContaining(
                    "pk_tenant_product_spu_sensitive_attributes");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_product_spu_sensitive_attributes (
                        tenant_id, spu_id, attribute_code, sort_order
                    ) VALUES (
                      '43000000-0000-0000-0000-000000000001',
                      '43000000-0000-0000-0000-000000000011',
                      'POWDER', 3)
                    """)).hasMessageContaining(
                    "ck_tenant_product_spu_sensitive_attributes_code_order");
        }
    }

    @Test
    void repositoryReadsAndReplacesOnlyWithinTenantInStableOrder()
            throws Exception {
        flyway().migrate();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            insertV45TenantsAndSpus(statement);
        }
        ProductSpuSensitiveAttributeRepository repository =
                new ProductSpuSensitiveAttributeRepository(
                        new NamedParameterJdbcTemplate(
                                new DriverManagerDataSource(
                                        jdbcUrl,
                                        username,
                                        password)));
        UUID tenantA = UUID.fromString(
                "43000000-0000-0000-0000-000000000001");
        UUID tenantB = UUID.fromString(
                "43000000-0000-0000-0000-000000000002");
        UUID spuA = UUID.fromString(
                "43000000-0000-0000-0000-000000000011");

        repository.replaceByTenantIdAndSpuId(
                tenantA,
                spuA,
                List.of(
                        ProductSensitiveAttributeCode.FLAMMABLE,
                        ProductSensitiveAttributeCode.BATTERY,
                        ProductSensitiveAttributeCode.FLAMMABLE));

        assertThat(repository.findByTenantIdAndSpuId(tenantA, spuA))
                .containsExactly(
                        ProductSensitiveAttributeCode.BATTERY,
                        ProductSensitiveAttributeCode.FLAMMABLE);
        assertThat(repository.findByTenantIdAndSpuId(tenantB, spuA))
                .isEmpty();
        assertThatThrownBy(() ->
                repository.replaceByTenantIdAndSpuId(
                        tenantB,
                        spuA,
                        List.of(ProductSensitiveAttributeCode.MAGNETIC)))
                .hasMessageContaining(
                        "fk_tenant_product_spu_sensitive_attributes_spu");
    }

    private static void insertLegacyTenantsAndSpus(Statement statement)
            throws Exception {
        statement.executeUpdate("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('43000000-0000-0000-0000-000000000001',
                   'product_a', 'Product A'),
                  ('43000000-0000-0000-0000-000000000002',
                   'product_b', 'Product B')
                """);
        statement.executeUpdate("""
                INSERT INTO tenant_product_spus (
                    id, tenant_id, business_code, name, description
                ) VALUES
                  ('43000000-0000-0000-0000-000000000011',
                   '43000000-0000-0000-0000-000000000001',
                   'V30_A', 'V30 中文名称', 'V30 description'),
                  ('43000000-0000-0000-0000-000000000012',
                   '43000000-0000-0000-0000-000000000002',
                   'V30_B', 'Tenant B', NULL)
                """);
    }

    private static void insertV45TenantsAndSpus(Statement statement)
            throws Exception {
        statement.executeUpdate("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('43000000-0000-0000-0000-000000000001',
                   'product_a', 'Product A'),
                  ('43000000-0000-0000-0000-000000000002',
                   'product_b', 'Product B')
                """);
        statement.executeUpdate("""
                INSERT INTO tenant_product_spus (
                    id, tenant_id, business_code, name, name_zh,
                    product_note
                ) VALUES
                  ('43000000-0000-0000-0000-000000000011',
                   '43000000-0000-0000-0000-000000000001',
                   'V30_A', 'V45 中文名称', 'V45 中文名称',
                   'V45 note'),
                  ('43000000-0000-0000-0000-000000000012',
                   '43000000-0000-0000-0000-000000000002',
                   'V30_B', 'Tenant B', 'Tenant B', NULL)
                """);
    }

    private static void migrateToV30() {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("30"))
                .load()
                .migrate();
    }

    private static Flyway flyway() {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("45"))
                .cleanDisabled(false)
                .load();
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private static long singleLong(Statement statement, String sql)
            throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }

    private static String singleString(Statement statement, String sql)
            throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }
}
