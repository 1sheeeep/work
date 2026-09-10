package cn.xzkj.erp.platformadmin.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.PasswordCredentialTokenService;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.application.PlatformAdminManagementService;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.Filter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

@TestMethodOrder(OrderAnnotation.class)
class PlatformAdminIntegrationTest {

    private static final String SEED_USERNAME =
            "platform.seed@example.com";
    private static final String SEED_PASSWORD = "seed-platform-password";
    private static final String SEED_CHANGED_PASSWORD =
            "seed-platform-changed-password";
    private static final String SECOND_PASSWORD = "second-platform-password";
    private static final String SECOND_RESET_PASSWORD =
            "second-platform-reset-password";
    private static final String SECOND_DISABLED_RESET_PASSWORD =
            "second-disabled-reset-password";

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static MockMvc mockMvc;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static String seedToken;
    private static String secondToken;
    private static UUID seedAdminId;
    private static UUID secondAdminId;
    private static UUID raceAdminId;
    private static UUID tenantAId;
    private static UUID tenantBId;
    private static String tenantAToken;
    private static String tenantBToken;

    @BeforeAll
    static void start() throws Exception {
        configureDatabase();
        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        seedAdmin();

        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "platform-admin-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test",
                        "erp.logistics-connector.credential-key",
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "erp.shopify-release.credential-key",
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "erp.security.password-credential-ttl", "PT30M",
                        "erp.security.login-throttle.max-failures", "20")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean(
                        "springSecurityFilterChain",
                        Filter.class))
                .build();
    }

    @AfterAll
    static void stop() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void platformAuthenticationHasNoTenantAndIsRouteScoped()
            throws Exception {
        mockMvc.perform(get("/api/v1/platform-admin/system-admins"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code")
                        .value("authentication_required"));

        mockMvc.perform(post("/api/v1/platform-admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"platform.seed@example.com",
                                 "password":"wrong-password-value"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));

        seedAdminId = systemAdminId(SEED_USERNAME);
        executeUpdate("""
                UPDATE platform_admin_login_throttles
                SET failed_count = 20,
                    locked_until = now() + interval '15 minutes',
                    updated_at = now()
                WHERE system_admin_id = ?::uuid
                """, seedAdminId);

        seedToken = platformLogin(SEED_USERNAME, SEED_PASSWORD);
        assertThat(singleLong("""
                SELECT count(*)
                FROM platform_admin_login_throttles
                WHERE system_admin_id = '%s'::uuid
                """.formatted(seedAdminId))).isZero();

        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.admin.id")
                        .value(seedAdminId.toString()))
                .andExpect(jsonPath("$.admin.status").value("ACTIVE"))
                .andExpect(jsonPath("$.tenant").doesNotExist());

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(post("/api/v1/platform-admin/system-admins")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"bad space",
                                 "displayName":"Invalid"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(put("/api/v1/platform-admin/system-admins/"
                                + UUID.randomUUID())
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Missing"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(post("/api/v1/platform-admin/system-admins/"
                                + seedAdminId
                                + "/disable")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(adminVersion(seedAdminId))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));

        mockMvc.perform(put("/api/v1/platform-admin/auth/password")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "currentPassword":"wrong-current-password",
                                  "newPassword":"must-not-change-password"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));
        mockMvc.perform(put("/api/v1/platform-admin/auth/password/reset")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"   "
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        String platformSelfCredential =
                insertOpenPlatformCredential(seedAdminId);
        mockMvc.perform(put("/api/v1/platform-admin/auth/password/reset")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"seed-platform-changed-password"
                                }
                                """))
                .andExpect(status().isNoContent());
        assertUniformCredentialError(platformSelfCredential);
        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isUnauthorized());
        seedToken = platformLogin(
                SEED_USERNAME,
                SEED_CHANGED_PASSWORD);
        assertThat(singleString("""
                SELECT details::text
                FROM platform_admin_audit_logs
                WHERE action = 'platform_admin.system_admin.password_reset'
                  AND resource_id = '%s'
                ORDER BY created_at DESC
                LIMIT 1
                """.formatted(seedAdminId)))
                .doesNotContain(
                        SEED_PASSWORD,
                        SEED_CHANGED_PASSWORD,
                        "password",
                        "hash",
                        "token",
                        "credential");
    }

    @Test
    @Order(2)
    void systemAdminLifecycleUsesSingleUseCredentialsAndRevokesSessions()
            throws Exception {
        CreatedAdmin second = createSystemAdmin(
                seedToken,
                "second.admin@example.com",
                "Second Admin");
        secondAdminId = second.id();
        assertThat(second.status()).isEqualTo("PENDING_ACTIVATION");
        assertThat(second.rawJson()).doesNotContain("password");

        redeemPlatformCredential(
                second.credential(),
                SECOND_PASSWORD,
                204);
        assertUniformCredentialError(second.credential());
        secondToken = platformLogin(
                "second.admin@example.com",
                SECOND_PASSWORD);

        String reset = issueResetCredential(seedToken, secondAdminId);
        redeemPlatformCredential(
                reset,
                SECOND_RESET_PASSWORD,
                204);
        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(secondToken)))
                .andExpect(status().isUnauthorized());
        secondToken = platformLogin(
                "second.admin@example.com",
                SECOND_RESET_PASSWORD);

        mockMvc.perform(post("/api/v1/platform-admin/system-admins/"
                                + secondAdminId
                                + "/disable")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(adminVersion(secondAdminId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"));
        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(secondToken)))
                .andExpect(status().isUnauthorized());

        String disabledReset =
                issueResetCredential(seedToken, secondAdminId);
        redeemPlatformCredential(
                disabledReset,
                SECOND_DISABLED_RESET_PASSWORD,
                204);
        mockMvc.perform(post("/api/v1/platform-admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(
                                "second.admin@example.com",
                                SECOND_DISABLED_RESET_PASSWORD)))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/v1/platform-admin/system-admins/"
                                + secondAdminId
                                + "/activate")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(adminVersion(secondAdminId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        secondToken = platformLogin(
                "second.admin@example.com",
                SECOND_DISABLED_RESET_PASSWORD);

        CreatedAdmin deleted = createSystemAdmin(
                seedToken,
                "deleted.pending@example.com",
                "Deleted Pending");
        mockMvc.perform(post("/api/v1/platform-admin/system-admins/"
                                + deleted.id()
                                + "/delete")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(adminVersion(deleted.id()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DELETED"));
        assertUniformCredentialError(deleted.credential());
    }

    @Test
    @Order(3)
    void credentialsAreIsolatedExpiringAndConcurrencySafe()
            throws Exception {
        CreatedAdmin expired = createSystemAdmin(
                seedToken,
                "expired.pending@example.com",
                "Expired Pending");
        executeUpdate("""
                UPDATE platform_admin_password_credentials
                SET expires_at = created_at + interval '1 millisecond'
                WHERE system_admin_id = ?
                """, expired.id());
        assertUniformCredentialError(expired.credential());

        CreatedAdmin race = createSystemAdmin(
                seedToken,
                "race.redeem@example.com",
                "Race Redeem");
        raceAdminId = race.id();
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> futures = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                int suffix = index;
                futures.add(executor.submit(() -> {
                    start.await();
                    return mockMvc.perform(post(
                                            "/api/v1/platform-admin/auth/password-credentials/redeem")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"token":"%s",
                                             "newPassword":"race-password-%d-safe"}
                                            """.formatted(
                                                race.credential(),
                                                suffix)))
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }
            start.countDown();
            List<Integer> statuses = futures.stream()
                    .map(PlatformAdminIntegrationTest::future)
                    .sorted()
                    .toList();
            assertThat(statuses).containsExactly(204, 401);
        }
        assertThat(singleInt("""
                SELECT count(*)
                FROM platform_admin_password_credentials
                WHERE system_admin_id = '%s'::uuid
                  AND consumed_at IS NOT NULL
                """.formatted(raceAdminId))).isEqualTo(1);
    }

    @Test
    @Order(4)
    void tenantProvisioningEntryAndIsolationAreServerBound()
            throws Exception {
        CreatedTenant tenantA = createTenant(
                "tenant_a",
                "Tenant A",
                "tenant.a.admin@example.com",
                "Tenant A Admin");
        tenantAId = tenantA.id();
        enableErp(seedToken, tenantAId);

        String tenantUserToken = tenantLogin(
                "tenant_a",
                "tenant.a.admin@example.com",
                tenantA.initialPassword());
        UUID tenantAdminId = tenantA.adminId();
        assertThat(singleInt("""
                SELECT count(*)
                FROM users
                WHERE id = '%s'::uuid
                  AND password_hash LIKE '{argon2id}%%'
                """.formatted(tenantAdminId))).isOne();
        assertThat(singleInt("""
                SELECT count(*)
                FROM password_credentials
                WHERE user_id = '%s'::uuid
                """.formatted(tenantAdminId))).isZero();
        MvcResult tenantUserMe = mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(tenantUserToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id")
                        .value(tenantAId.toString()))
                .andExpect(jsonPath("$.user.id")
                        .value(tenantAdminId.toString()))
                .andExpect(jsonPath("$.user.username")
                        .value("tenant.a.admin@example.com"))
                .andExpect(jsonPath("$.user.email")
                        .value("tenant.a.admin@example.com"))
                .andExpect(jsonPath("$.platformAdmin")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andReturn();
        assertThat(JsonPath.<Map<String, Object>>read(
                        tenantUserMe.getResponse().getContentAsString(),
                        "$").keySet())
                .containsExactlyInAnyOrder(
                        "tenant",
                        "user",
                        "platformAdmin",
                        "permissions",
                        "applications",
                        "expiresAt");
        mockMvc.perform(get("/api/v1/platform-admin/tenants")
                        .header(
                                "Authorization",
                                bearer(tenantUserToken)))
                .andExpect(status().isForbidden());

        CreatedTenant tenantB = createTenant(
                "tenant_b",
                "Tenant B",
                "tenant.b.admin@example.com",
                "Tenant B Admin");
        tenantBId = tenantB.id();
        enableErp(seedToken, tenantBId);

        MvcResult createdEnterpriseAdmin = mockMvc.perform(post(
                                "/api/v1/platform-admin/tenants/"
                                        + tenantBId
                                        + "/enterprise-admins")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"tenant.b.second.admin@example.com",
                                  "displayName":"Tenant B Second Admin",
                                  "initialPassword":"tenant-b-second-password"
                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.admin.username")
                        .value("tenant.b.second.admin@example.com"))
                .andExpect(jsonPath("$.admin.email")
                        .value("tenant.b.second.admin@example.com"))
                .andExpect(jsonPath("$.admin.status").value("ACTIVE"))
                .andExpect(jsonPath("$.admin.version").value(0))
                .andExpect(jsonPath("$.activationCredential").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andReturn();
        String enterpriseAdminJson =
                createdEnterpriseAdmin.getResponse().getContentAsString();
        UUID secondEnterpriseAdminId = UUID.fromString(
                JsonPath.read(enterpriseAdminJson, "$.admin.id"));
        String secondEnterpriseAdminToken = tenantLogin(
                "tenant_b",
                "tenant.b.second.admin@example.com",
                "tenant-b-second-password");
        assertThat(singleInt("""
                SELECT count(*)
                FROM password_credentials
                WHERE user_id = '%s'::uuid
                """.formatted(secondEnterpriseAdminId))).isZero();

        mockMvc.perform(post("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"tenant.b.second.admin@example.com",
                                  "displayName":"Duplicate",
                                  "initialPassword":"duplicate-admin-password"
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantAId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Cross Tenant",
                                  "status":"ACTIVE",
                                  "version":0
                                }
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + UUID.randomUUID())
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Unknown",
                                  "status":"ACTIVE",
                                  "version":0
                                }
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Tenant B Renamed Admin",
                                  "status":"ACTIVE",
                                  "version":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName")
                        .value("Tenant B Renamed Admin"))
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "username":"must_remain_immutable",
                                  "displayName":"Tenant B Renamed Admin",
                                  "status":"ACTIVE",
                                  "version":1
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        String enterpriseAdminCredential = insertOpenTenantCredential(
                tenantBId,
                secondEnterpriseAdminId);
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Stale Update",
                                  "status":"ACTIVE",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("optimistic_lock_conflict"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId
                                + "/password")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"   ",
                                  "version":1
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId
                                + "/password")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"123456",
                                  "version":1
                                }
                                """))
                .andExpect(status().isNoContent());
        assertUniformTenantCredentialError(enterpriseAdminCredential);
        mockMvc.perform(get("/api/v1/auth/me")
                        .header(
                                "Authorization",
                                bearer(secondEnterpriseAdminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id")
                        .value(secondEnterpriseAdminId.toString()));
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"tenant_b",
                                  "email":"tenant.b.second.admin@example.com",
                                  "password":"tenant-b-second-password"
                                }
                                """))
                .andExpect(status().isUnauthorized());
        tenantLogin(
                "tenant_b",
                "tenant.b.second.admin@example.com",
                "123456");
        assertThat(singleString("""
                SELECT details::text
                FROM platform_admin_audit_logs
                WHERE action = 'platform_admin.enterprise_admin.password_reset'
                  AND resource_id = '%s'
                ORDER BY created_at DESC
                LIMIT 1
                """.formatted(secondEnterpriseAdminId)))
                .doesNotContain(
                        "123456",
                        "password",
                        "hash",
                        "token",
                        "credential");

        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Tenant B Renamed Admin",
                                  "status":"DISABLED",
                                  "version":2
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"))
                .andExpect(jsonPath("$.version").value(3));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + tenantB.adminId())
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Tenant B Admin",
                                  "status":"DISABLED",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantBId
                                + "/enterprise-admins/"
                                + secondEnterpriseAdminId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Tenant B Renamed Admin",
                                  "status":"ACTIVE",
                                  "version":3
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.version").value(4));

        tenantAToken = enterTenant(seedToken, tenantAId);
        tenantBToken = enterTenant(seedToken, tenantBId);
        mockMvc.perform(get("/api/v1/platform-admin/tenants")
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isForbidden());
        UUID tenantAdminRoleId = UUID.fromString(singleString("""
                SELECT id::text
                FROM roles
                WHERE tenant_id = '%s'::uuid
                  AND code = 'tenant_admin'
                """.formatted(tenantAId)));
        MvcResult platformManagedMember = mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(tenantAToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"platform.managed@example.com",
                                  "displayName":"Platform Managed",
                                  "initialPassword":"platform-managed-password",
                                  "roleIds":["%s"]
                                }
                                """.formatted(tenantAdminRoleId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.version").value(0))
                .andReturn();
        UUID platformManagedMemberId = UUID.fromString(JsonPath.read(
                platformManagedMember.getResponse().getContentAsString(),
                "$.id"));
        mockMvc.perform(put("/api/v1/iam/members/"
                                + platformManagedMemberId
                                + "/roles")
                        .header("Authorization", bearer(tenantAToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ids":[],"version":0}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignmentIds").isEmpty())
                .andExpect(jsonPath("$.version").value(1));

        MvcResult warehouseA = mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(tenantAToken))
                        .header("X-Tenant-Id", tenantBId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"WAREHOUSE_A",
                                 "name":"Warehouse A"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID warehouseAId = UUID.fromString(JsonPath.read(
                warehouseA.getResponse().getContentAsString(),
                "$.id"));
        assertThat(singleString("""
                SELECT tenant_id::text
                FROM tenant_warehouses
                WHERE id = '%s'::uuid
                """.formatted(warehouseAId)))
                .isEqualTo(tenantAId.toString());

        MvcResult warehouseB = mockMvc.perform(post(
                                "/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(tenantBToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"WAREHOUSE_B",
                                 "name":"Warehouse B"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        UUID warehouseBId = UUID.fromString(JsonPath.read(
                warehouseB.getResponse().getContentAsString(),
                "$.id"));
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses/"
                                + warehouseBId)
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isNotFound());

        executeUpdate("""
                INSERT INTO permissions (
                    id, code, module, name, description
                ) VALUES (
                    gen_random_uuid(), 'future:permission',
                    'future', 'Future permission', 'Dynamic test'
                )
                """);
        MvcResult platformTenantMe =
                mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id")
                        .value(tenantAId.toString()))
                .andExpect(jsonPath("$.user")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.platformAdmin.id")
                        .value(seedAdminId.toString()))
                .andExpect(jsonPath("$.platformAdmin.username")
                        .value(SEED_USERNAME))
                .andExpect(jsonPath("$.platformAdmin.email")
                        .value(SEED_USERNAME))
                .andExpect(jsonPath("$.platformAdmin.displayName")
                        .value("Platform Seed"))
                .andExpect(jsonPath("$.platformAdmin.status")
                        .value("ACTIVE"))
                .andExpect(jsonPath("$.permissions")
                        .value(org.hamcrest.Matchers.hasItem(
                                "future:permission")))
                .andReturn();
        assertThat(JsonPath.<Map<String, Object>>read(
                        platformTenantMe.getResponse().getContentAsString(),
                        "$").keySet())
                .containsExactlyInAnyOrder(
                        "tenant",
                        "user",
                        "platformAdmin",
                        "permissions",
                        "applications",
                        "expiresAt");
        assertThat(singleInt("""
                SELECT count(*)
                FROM users
                WHERE tenant_id = '%s'::uuid
                  AND username = '%s'
                """.formatted(tenantAId, SEED_USERNAME)))
                .isZero();

        mockMvc.perform(put("/api/v1/iam/members/"
                                + tenantAdminId
                                + "/password")
                        .header("Authorization", bearer(tenantAToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"123456",
                                  "version":0
                                }
                                """))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(tenantUserToken)))
                .andExpect(status().isUnauthorized());
        tenantLogin(
                "tenant_a",
                "tenant.a.admin@example.com",
                "123456");

        String corruptedToken = "T".repeat(43);
        PasswordCredentialTokenService tokenService =
                context.getBean(PasswordCredentialTokenService.class);
        String corruptedHash =
                tokenService.hashPresented(corruptedToken.toCharArray());
        UUID secondPlatformSessionId = UUID.fromString(singleString("""
                SELECT id::text
                FROM platform_admin_sessions
                WHERE system_admin_id = '%s'::uuid
                  AND revoked_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """.formatted(secondAdminId)));
        insertCorruptedTenantSession(
                secondPlatformSessionId,
                seedAdminId,
                tenantAId,
                corruptedHash);
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(corruptedToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code")
                        .value("authentication_required"));

        assertThat(singleInt("""
                SELECT count(*)
                FROM audit_logs
                WHERE tenant_id = '%s'::uuid
                  AND actor_system_admin_id = '%s'::uuid
                  AND action = 'platform_admin.tenant_write_attempted'
                """.formatted(tenantAId, seedAdminId)))
                .isGreaterThanOrEqualTo(1);

        mockMvc.perform(delete("/api/v1/platform-admin/tenant-session")
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(tenantBToken)))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/platform-admin/auth/me")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isOk());

        tenantAToken = enterTenant(seedToken, tenantAId);
        mockMvc.perform(put("/api/v1/platform-admin/tenants/" + tenantAId)
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Tenant A Disabled",
                                 "status":"DISABLED",
                                 "version":%d}
                                """.formatted(tenantVersion(tenantAId))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"));
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .header("Authorization", bearer(tenantAToken)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/platform-admin/tenants/"
                                + tenantAId
                                + "/enter")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isNotFound());
    }

    @Test
    @Order(5)
    void logisticsProviderCredentialsRequireDelegatedErpOperatorAndNeverEcho()
            throws Exception {
        String customerCode = "provider-customer-uat";
        String authorizationCode = "provider-authorization-uat";
        String secret = "provider-secret-uat";

        mockMvc.perform(get(
                        "/api/v1/erp-operator/logistics-provider-configs"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(
                        "/api/v1/erp-operator/logistics-provider-configs")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isForbidden());
        mockMvc.perform(put(
                        "/api/v1/erp-operator/logistics-provider-configs/DAYUNJIA/name")
                        .header("Authorization", bearer(tenantBToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "providerName":"达运佳物流",
                                  "version":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerCode").value("DAYUNJIA"))
                .andExpect(jsonPath("$.providerName").value("达运佳物流"))
                .andExpect(jsonPath("$.nameVersion").value(1));
        mockMvc.perform(put(
                        "/api/v1/erp-operator/logistics-provider-configs/CHUDA")
                        .header("Authorization", bearer(tenantBToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "customerCode":"%s",
                                  "authorizationCode":"%s",
                                  "secret":"%s",
                                  "version":0
                                }
                                """.formatted(customerCode,
                                        authorizationCode, secret)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providerCode").value("CHUDA"))
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.customerCode").doesNotExist())
                .andExpect(jsonPath("$.authorizationCode").doesNotExist())
                .andExpect(jsonPath("$.secret").doesNotExist())
                .andExpect(jsonPath("$.version").value(1));

        MvcResult result = mockMvc.perform(get(
                        "/api/v1/erp-operator/logistics-provider-configs")
                        .header("Authorization", bearer(tenantBToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].providerName").value("触达物流"))
                .andExpect(jsonPath("$[0].configured").value(true))
                .andExpect(jsonPath("$.length()").value(9))
                .andExpect(jsonPath("$[1].providerName")
                        .value("达运佳物流"))
                .andExpect(jsonPath("$[1].configurationMode")
                        .value("BUILT_IN"))
                .andExpect(jsonPath("$[5].providerName")
                        .value("桐溪供应链"))
                .andExpect(jsonPath("$[6].providerName")
                        .value("嘉运晟途"))
                .andReturn();
        mockMvc.perform(get("/api/v1/logistics/authorizations/providers")
                        .header("Authorization", bearer(tenantBToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[1].providerCode").value("DAYUNJIA"))
                .andExpect(jsonPath("$.items[1].providerName").value("达运佳物流"));
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain(customerCode, authorizationCode, secret);
        String ciphertext = new String(singleBytes("""
                SELECT ciphertext
                FROM system_logistics_provider_credentials
                WHERE provider_code = 'CHUDA'
                """), java.nio.charset.StandardCharsets.ISO_8859_1);
        assertThat(ciphertext).doesNotContain(
                customerCode, authorizationCode, secret);
        assertThat(singleInt("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE action = 'platform_admin.logistics_provider_config.updated'
                  AND resource_id = 'CHUDA'
                """)).isOne();
    }

    @Test
    @Order(7)
    void concurrentGlobalUsernameCreationReturnsOneConflict()
            throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> futures = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                String candidate = index == 0
                        ? "Concurrent.Name@Example.com"
                        : "concurrent.name@example.com";
                futures.add(executor.submit(() -> {
                    start.await();
                    return mockMvc.perform(post(
                                            "/api/v1/platform-admin/system-admins")
                                    .header(
                                            "Authorization",
                                            bearer(seedToken))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"email":"%s",
                                             "displayName":"Concurrent"}
                                            """.formatted(candidate)))
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }
            start.countDown();
            assertThat(futures.stream()
                    .map(PlatformAdminIntegrationTest::future)
                    .sorted()
                    .toList())
                    .containsExactly(201, 409);
        }
        assertThat(singleInt("""
                SELECT count(*)
                FROM system_admins
                WHERE lower(username) = 'concurrent.name@example.com'
                """)).isOne();
    }

    @Test
    @Order(8)
    void concurrentDisableCannotRemoveBothLastActiveAdmins()
            throws Exception {
        String raceToken = platformLogin(
                "race.redeem@example.com",
                "race-password-0-safe",
                "race-password-1-safe");
        mockMvc.perform(post("/api/v1/platform-admin/system-admins/"
                                + raceAdminId
                                + "/disable")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(adminVersion(raceAdminId))))
                .andExpect(status().isOk());
        assertThat(raceToken).isNotBlank();

        PlatformAdminManagementService service =
                context.getBean(PlatformAdminManagementService.class);
        long seedVersion = adminVersion(seedAdminId);
        long secondVersion = adminVersion(secondAdminId);
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Boolean> disableSecond = executor.submit(() -> {
                start.await();
                try {
                    service.disable(
                            new PlatformAdminActor(
                                    seedAdminId,
                                    UUID.randomUUID(),
                                    "last-active-a",
                                    "127.0.0.1"),
                            secondAdminId,
                            secondVersion);
                    return true;
                } catch (RuntimeException conflict) {
                    return false;
                }
            });
            Future<Boolean> disableSeed = executor.submit(() -> {
                start.await();
                try {
                    service.disable(
                            new PlatformAdminActor(
                                    secondAdminId,
                                    UUID.randomUUID(),
                                    "last-active-b",
                                    "127.0.0.1"),
                            seedAdminId,
                            seedVersion);
                    return true;
                } catch (RuntimeException conflict) {
                    return false;
                }
            });
            start.countDown();
            assertThat(List.of(
                            disableSecond.get(),
                            disableSeed.get()))
                    .containsExactlyInAnyOrder(true, false);
        }
        assertThat(singleInt("""
                SELECT count(*)
                FROM system_admins
                WHERE status = 'ACTIVE'
                """)).isOne();
        assertThat(singleInt("""
                SELECT active_count
                FROM system_admin_state_guard
                """)).isOne();
    }

    @Test
    @Order(6)
    void shopifyReleaseRequiresDelegatedErpOperatorAndNeverEchoesToken()
            throws Exception {
        String automationToken =
                "shopify-automation-token-integration-only-123456789";

        mockMvc.perform(get(
                        "/api/v1/erp-operator/shopify-app-release"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(
                        "/api/v1/erp-operator/shopify-app-release")
                        .header("Authorization", bearer(seedToken)))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(
                        "/api/v1/erp-operator/shopify-app-release")
                        .header("Authorization", bearer(tenantBToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.appName").value("Xinzhi ERP"))
                .andExpect(jsonPath("$.extensionName").value("Xinzhi Chat"))
                .andExpect(jsonPath("$.tokenConfigured").value(false))
                .andExpect(jsonPath("$.status").value("NOT_CONFIGURED"))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.automationToken").doesNotExist());

        MvcResult saved = mockMvc.perform(put(
                        "/api/v1/erp-operator/shopify-app-release/token")
                        .header("Authorization", bearer(tenantBToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"automationToken":"%s","version":0}
                                """.formatted(automationToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenConfigured").value(true))
                .andExpect(jsonPath("$.status").value("CONFIGURED"))
                .andExpect(jsonPath("$.automationToken").doesNotExist())
                .andReturn();
        assertThat(saved.getResponse().getContentAsString())
                .doesNotContain(automationToken);
        String ciphertext = new String(singleBytes("""
                SELECT token_ciphertext
                FROM system_shopify_app_release
                WHERE singleton_id = 1
                """), java.nio.charset.StandardCharsets.ISO_8859_1);
        assertThat(ciphertext).doesNotContain(automationToken);
        assertThat(singleInt("""
                SELECT octet_length(token_nonce)
                FROM system_shopify_app_release
                WHERE singleton_id = 1
                """)).isEqualTo(12);
        assertThat(singleInt("""
                SELECT count(*)
                FROM platform_admin_audit_logs
                WHERE action = 'platform_admin.shopify_app_release.token_updated'
                """)).isOne();

        mockMvc.perform(delete(
                        "/api/v1/erp-operator/shopify-app-release/token")
                        .header("Authorization", bearer(tenantBToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(versionBody(0)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenConfigured").value(false))
                .andExpect(jsonPath("$.status").value("NOT_CONFIGURED"));
        assertThat(singleInt("""
                SELECT count(*)
                FROM system_shopify_app_release
                """)).isZero();
    }

    private static CreatedAdmin createSystemAdmin(
            String token,
            String adminUsername,
            String displayName) throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/system-admins")
                        .header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","displayName":"%s"}
                                """.formatted(adminUsername, displayName)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username")
                        .value(adminUsername.strip().toLowerCase(Locale.ROOT)))
                .andExpect(jsonPath("$.email")
                        .value(adminUsername.strip().toLowerCase(Locale.ROOT)))
                .andExpect(jsonPath("$.activationCredential.token")
                        .isString())
                .andReturn();
        String json = result.getResponse().getContentAsString();
        return new CreatedAdmin(
                UUID.fromString(JsonPath.read(json, "$.id")),
                JsonPath.read(json, "$.status"),
                JsonPath.read(json, "$.activationCredential.token"),
                json);
    }

    private static CreatedTenant createTenant(
            String code,
            String name,
            String adminUsername,
            String adminDisplayName) throws Exception {
        String initialPassword = "direct-" + code + "-admin-password";
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/tenants")
                        .header("Authorization", bearer(seedToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s","name":"%s",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"%s",
                                 "adminInitialPassword":"%s"}
                                """.formatted(
                                    code,
                                    name,
                                    adminUsername,
                                    adminDisplayName,
                                    initialPassword)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tenant.adminCount").value(1))
                .andExpect(jsonPath("$.tenant.memberCount").value(1))
                .andExpect(jsonPath("$.enterpriseAdmin.status")
                        .value("ACTIVE"))
                .andExpect(jsonPath("$.enterpriseAdmin.email")
                        .value(adminUsername.strip().toLowerCase(Locale.ROOT)))
                .andExpect(jsonPath("$.enterpriseAdmin.version").value(0))
                .andExpect(jsonPath("$.activationCredential").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andReturn();
        String json = result.getResponse().getContentAsString();
        return new CreatedTenant(
                UUID.fromString(JsonPath.read(json, "$.tenant.id")),
                UUID.fromString(JsonPath.read(
                        json,
                        "$.enterpriseAdmin.id")),
                initialPassword);
    }

    private static String platformLogin(
            String loginUsername,
            String... candidatePasswords) throws Exception {
        for (String candidate : candidatePasswords) {
            MvcResult result = mockMvc.perform(post(
                                    "/api/v1/platform-admin/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(loginBody(loginUsername, candidate)))
                    .andReturn();
            if (result.getResponse().getStatus() == 200) {
                return JsonPath.read(
                        result.getResponse().getContentAsString(),
                        "$.accessToken");
            }
        }
        throw new AssertionError("No candidate platform password logged in");
    }

    private static String tenantLogin(
            String tenantCode,
            String loginUsername,
            String loginPassword) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tenantCode":"%s","email":"%s",
                                 "password":"%s"}
                                """.formatted(
                                    tenantCode,
                                    loginUsername,
                                    loginPassword)))
                .andExpect(status().isOk())
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static String enterTenant(
            String platformToken,
            UUID tenantId) throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/tenants/"
                                        + tenantId
                                        + "/enter")
                        .header(
                                "Authorization",
                                bearer(platformToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.platformAdmin.status")
                        .value("ACTIVE"))
                .andExpect(jsonPath("$.permissions")
                        .value(org.hamcrest.Matchers.hasItem(
                                "warehouses.write")))
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static void enableErp(String platformToken, UUID tenantId)
            throws Exception {
        mockMvc.perform(put("/api/v1/platform-admin/tenants/"
                                + tenantId
                                + "/entitlements")
                        .header("Authorization", bearer(platformToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "version":0,
                                  "applications":[{
                                    "code":"ERP",
                                    "modules":[
                                      "CHANNELS","PRODUCTS","ORDERS",
                                      "PROCUREMENT","WAREHOUSE","LOGISTICS",
                                      "ANALYTICS"
                                    ]
                                  }]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applications[0].code").value("ERP"));
    }

    private static String issueResetCredential(
            String token,
            UUID adminId) throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/platform-admin/system-admins/"
                                        + adminId
                                        + "/password-credentials")
                        .header("Authorization", bearer(token)))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.token");
    }

    private static void redeemPlatformCredential(
            String token,
            String newPassword,
            int expectedStatus) throws Exception {
        mockMvc.perform(post(
                                "/api/v1/platform-admin/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(token, newPassword)))
                .andExpect(status().is(expectedStatus));
    }

    private static void redeemTenantCredential(
            String token,
            String newPassword) throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(token, newPassword)))
                .andExpect(status().isNoContent());
    }

    private static void assertUniformCredentialError(String token)
            throws Exception {
        mockMvc.perform(post(
                                "/api/v1/platform-admin/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(
                                token,
                                "uniform-error-password")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code")
                        .value("invalid_password_credential"))
                .andExpect(jsonPath("$.message")
                        .value("Password credential is invalid or unavailable"));
    }

    private static void assertUniformTenantCredentialError(String token)
            throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(
                                token,
                                "must-not-redeem-old-token")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code")
                        .value("invalid_password_credential"))
                .andExpect(jsonPath("$.message")
                        .value("Credential is invalid or expired"));
    }

    private static String insertOpenPlatformCredential(UUID adminId)
            throws Exception {
        PasswordCredentialTokenService.GeneratedToken token =
                context.getBean(PasswordCredentialTokenService.class)
                        .generate();
        executeUpdate("""
                INSERT INTO platform_admin_password_credentials (
                    id,
                    system_admin_id,
                    purpose,
                    token_hash,
                    expires_at,
                    created_by_system_admin_id,
                    created_at
                ) VALUES (
                    ?::uuid,
                    ?::uuid,
                    'RESET',
                    ?,
                    now() + interval '30 minutes',
                    ?::uuid,
                    now()
                )
                """,
                UUID.randomUUID(),
                adminId,
                token.tokenHash(),
                adminId);
        return token.rawToken();
    }

    private static String insertOpenTenantCredential(
            UUID tenantId,
            UUID userId) throws Exception {
        PasswordCredentialTokenService.GeneratedToken token =
                context.getBean(PasswordCredentialTokenService.class)
                        .generate();
        executeUpdate("""
                INSERT INTO password_credentials (
                    id,
                    tenant_id,
                    user_id,
                    purpose,
                    token_hash,
                    expires_at,
                    created_by_user_id,
                    created_at
                ) VALUES (
                    ?::uuid,
                    ?::uuid,
                    ?::uuid,
                    'PASSWORD_RESET',
                    ?,
                    now() + interval '30 minutes',
                    ?::uuid,
                    now()
                )
                """,
                UUID.randomUUID(),
                tenantId,
                userId,
                token.tokenHash(),
                userId);
        return token.rawToken();
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static String loginBody(
            String loginUsername,
            String loginPassword) {
        return """
                {"email":"%s","password":"%s"}
                """.formatted(loginUsername, loginPassword);
    }

    private static String credentialBody(
            String token,
            String newPassword) {
        return """
                {"token":"%s","newPassword":"%s"}
                """.formatted(token, newPassword);
    }

    private static String versionBody(long version) {
        return "{\"version\":" + version + "}";
    }

    private static long adminVersion(UUID adminId) throws Exception {
        return singleLong("""
                SELECT version
                FROM system_admins
                WHERE id = '%s'::uuid
                """.formatted(adminId));
    }

    private static long tenantVersion(UUID tenantId) throws Exception {
        return singleLong("""
                SELECT version
                FROM tenants
                WHERE id = '%s'::uuid
                """.formatted(tenantId));
    }

    private static UUID systemAdminId(String value) throws Exception {
        return UUID.fromString(singleString("""
                SELECT id::text
                FROM system_admins
                WHERE lower(username) = lower('%s')
                """.formatted(value)));
    }

    private static void seedAdmin() throws Exception {
        String storedHash = "{bcrypt}" + new BCryptPasswordEncoder(12)
                .encode(SEED_PASSWORD);
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO system_admins (
                            id, username, email, display_name, password_hash,
                            status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', now(), now())
                        """)) {
            statement.setObject(1, UUID.randomUUID());
            statement.setString(2, SEED_USERNAME);
            statement.setString(3, SEED_USERNAME);
            statement.setString(4, "Platform Seed");
            statement.setString(5, storedHash);
            statement.executeUpdate();
        }
    }

    private static void executeUpdate(String sql, Object... parameters)
            throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < parameters.length; index++) {
                statement.setObject(index + 1, parameters[index]);
            }
            statement.executeUpdate();
        }
    }

    private static void insertCorruptedTenantSession(
            UUID platformSessionId,
            UUID systemAdminId,
            UUID tenantId,
            String tokenHash) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement control = connection.createStatement();
                PreparedStatement insert = connection.prepareStatement("""
                        INSERT INTO platform_admin_tenant_sessions (
                            id, platform_session_id, system_admin_id, tenant_id,
                            token_hash, expires_at, created_at
                        ) VALUES (?, ?, ?, ?, ?, now() + interval '1 hour', now())
                        """)) {
            control.execute("SET session_replication_role = replica");
            try {
                insert.setObject(1, UUID.randomUUID());
                insert.setObject(2, platformSessionId);
                insert.setObject(3, systemAdminId);
                insert.setObject(4, tenantId);
                insert.setString(5, tokenHash);
                insert.executeUpdate();
            } finally {
                control.execute("SET session_replication_role = origin");
            }
        }
    }

    private static int singleInt(String sql) throws Exception {
        return Math.toIntExact(singleLong(sql));
    }

    private static long singleLong(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }

    private static String singleString(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }

    private static byte[] singleBytes(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getBytes(1);
        }
    }

    private static <T> T future(Future<T> future) {
        try {
            return future.get();
        } catch (Exception failure) {
            throw new AssertionError(failure);
        }
    }

    private static void configureDatabase() {
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
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_test")
                    .withUsername("erp_test")
                    .withPassword("erp_test");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailableDocker) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private record CreatedAdmin(
            UUID id,
            String status,
            String credential,
            String rawJson) {
    }

    private record CreatedTenant(
            UUID id,
            UUID adminId,
            String initialPassword) {
    }
}
