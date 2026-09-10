package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.testing.BusinessApplicationTestData;

class StoreAppReadPreparationPostgresql16GateTest {
    @TempDir Path temporary;
    private static final UUID TENANT = StoreAppReadPreparationTest.TENANT;
    private static final UUID SHOP = StoreAppReadPreparationTest.SHOP;
    private static final UUID USER = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID ROLE = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final String SESSION = "S".repeat(43);

    @Test void realSpringSecurityPostgresAndGoPreserveAuthorizationAndRejectRevokedAccess() throws Exception {
        // Never accept ERP_TEST_DB_URL or any external database override.
        try (var postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(image -> false).withDatabaseName("store_app_preparation")
                .withUsername("synthetic_erp").withPassword("synthetic_erp");
             var go = SyntheticStoreAppProcess.start(temporary)) {
            postgres.start();
            var environment = new StandardEnvironment();
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
            environment.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
            Map<String, Object> properties = new HashMap<>();
            properties.put("spring.datasource.url", postgres.getJdbcUrl());
            properties.put("spring.datasource.username", postgres.getUsername());
            properties.put("spring.datasource.password", postgres.getPassword());
            properties.put("server.address", "127.0.0.1"); properties.put("server.port", "0");
            properties.put("erp.environment", "integration-test"); properties.put("logging.level.root", "ERROR");
            properties.put("spring.main.banner-mode", "off"); properties.put("erp.channel-connector.mode", "unconfigured");
            String prefix = "erp.store-app-read-preparation.";
            properties.put(prefix+"enabled", "true"); properties.put(prefix+"tenant-id", TENANT.toString());
            properties.put(prefix+"shop-id", SHOP.toString()); properties.put(prefix+"shop-domain", StoreAppReadPreparationTest.DOMAIN);
            properties.put(prefix+"binding-version", "7"); properties.put(prefix+"base-url", go.baseUrl);
            properties.put(prefix+"service-token", StoreAppReadPreparationTest.TOKEN);
            environment.getPropertySources().addFirst(new MapPropertySource("owned-synthetic-preparation", properties));
            try (var application = new SpringApplicationBuilder(ErpApplication.class).web(WebApplicationType.SERVLET).environment(environment).run()) {
                var dataSource = application.getBean(DataSource.class); var db = new JdbcTemplate(dataSource);
                seed(db);
                try (var connection = dataSource.getConnection()) { BusinessApplicationTestData.enableErpForTenant(connection,TENANT); }
                String base = "http://127.0.0.1:" + application.getEnvironment().getRequiredProperty("local.server.port");
                String path = "/api/v1/platform-center/shops/" + SHOP + "/store-app-read-preparation";
                Map<String,String> before = unchangedTables(db);
                assertThat(send(base,path,null).statusCode()).isEqualTo(401);
                var status = send(base,path,SESSION);
                assertThat(status.statusCode()).as("preparation HTTP status").isEqualTo(200);
                assertThat(status.headers().firstValue("Cache-Control").orElse("")).isEqualTo("no-store");
                assertThat(status.body()).contains("CUSTOMER_SERVICE_STORE_APP_READ_ONLY", "\"productionReady\":false");
                var orders = send(base,path+"/orders?limit=10",SESSION);
                assertThat(orders.statusCode()).isEqualTo(200);
                assertThat(orders.body()).contains("#SYNTHETIC-123").doesNotContain("synthetic-owner-token", StoreAppReadPreparationTest.TOKEN);
                assertThat(unchangedTables(db)).isEqualTo(before);
                assertThat(application.getBean(ChannelConnectorGateway.class)).isInstanceOf(UnconfiguredChannelConnectorGateway.class);
                assertThat(send(base,path.replace(SHOP.toString(),UUID.randomUUID().toString()),SESSION).statusCode()).isNotEqualTo(200);
                assertThat(send(base,path+"/orders?limit=26",SESSION).statusCode()).isEqualTo(400);
                db.update("DELETE FROM role_permissions WHERE role_id = ? AND permission_id IN (SELECT id FROM permissions WHERE code = 'orders.read')",ROLE);
                assertThat(send(base,path+"/orders",SESSION).statusCode()).isEqualTo(403);
                db.update("UPDATE users SET status = 'DISABLED' WHERE id = ?",USER);
                assertThat(send(base,path,SESSION).statusCode()).isEqualTo(401);
                var evidence = new ObjectMapper().readTree(send(go.baseUrl,"/rehearsal/evidence",null).body());
                assertThat(evidence.path("ownerStateUnchanged").asBoolean()).isTrue();
                assertThat(evidence.path("orderReads").asInt()).isEqualTo(1);
                assertThat(evidence.path("blockedUpstreamRequests").asInt()).isZero();
            }
        }
    }

    private static HttpResponse<String> send(String base, String path, String session) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofSeconds(15));
        if (session != null) builder.header("Authorization","Bearer "+session);
        return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build().send(builder.build(),HttpResponse.BodyHandlers.ofString());
    }
    private static void seed(JdbcTemplate db) throws Exception {
        db.update("INSERT INTO tenants (id,code,name) VALUES (?,'synthetic_preparation','Synthetic preparation enterprise')",TENANT);
        db.update("INSERT INTO users (id,tenant_id,username,email,display_name,status) VALUES (?,?,'preparation@example.invalid','preparation@example.invalid','Synthetic preparation user','ACTIVE')",USER,TENANT);
        db.update("INSERT INTO roles (id,tenant_id,code,name) VALUES (?,?,'preparation_reader','Synthetic preparation reader')",ROLE,TENANT);
        db.update("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)",TENANT,USER,ROLE);
        assertThat(db.update("INSERT INTO role_permissions (tenant_id,role_id,permission_id) SELECT ?,?,id FROM permissions WHERE code IN ('shop:read','shop:authorization:write','orders.read')",TENANT,ROLE)).isEqualTo(3);
        UUID platform = db.queryForObject("SELECT id FROM platform_catalog WHERE code = 'SHOPIFY'",UUID.class);
        db.update("INSERT INTO tenant_shops (id,tenant_id,platform_id,external_shop_ref,display_name) VALUES (?,?,?,?,'Synthetic preparation shop')",SHOP,TENANT,platform,StoreAppReadPreparationTest.DOMAIN);
        db.update("INSERT INTO shop_authorizations (tenant_id,shop_id) VALUES (?,?)",TENANT,SHOP);
        String tokenHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(SESSION.getBytes(StandardCharsets.UTF_8)));
        db.update("INSERT INTO auth_sessions (id,tenant_id,user_id,token_hash,expires_at) VALUES (?,?,?,?,now()+interval '1 hour')",UUID.randomUUID(),TENANT,USER,tokenHash);
    }
    private static Map<String,String> unchangedTables(JdbcTemplate db) {
        var result = new HashMap<String,String>();
        // Table names are compile-time test constants, never user input. Only
        // compare hashes in memory; never emit account/session data or hashes.
        for (String table : List.of("tenant_shops","shop_authorizations","tenant_orders","users","roles","auth_sessions")) {
            result.put(table,db.queryForObject("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) FROM "+table+" t",String.class));
        }
        return result;
    }
}
