package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.Filter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
class IamAdministrationIntegrationTest {

    private static final String TENANT_A =
            "a0000000-0000-0000-0000-000000000001";
    private static final String TENANT_B =
            "a0000000-0000-0000-0000-000000000002";
    private static final String ADMIN_USER =
            "a1000000-0000-0000-0000-000000000001";
    private static final String ORDINARY_USER =
            "a1000000-0000-0000-0000-000000000002";
    private static final String MANAGED_USER =
            "a1000000-0000-0000-0000-000000000003";
    private static final String FOREIGN_USER =
            "a1000000-0000-0000-0000-000000000004";
    private static final String FILTER_LITERAL_USER =
            "a1000000-0000-0000-0000-000000000005";
    private static final String FILTER_ALPHA_USER =
            "a1000000-0000-0000-0000-000000000006";
    private static final String FILTER_BRAVO_USER =
            "a1000000-0000-0000-0000-000000000007";
    private static final String FILTER_FOREIGN_USER =
            "a1000000-0000-0000-0000-000000000008";
    private static final String ADMIN_ROLE =
            "a2000000-0000-0000-0000-000000000001";
    private static final String SYSTEM_ROLE =
            "a2000000-0000-0000-0000-000000000002";
    private static final String ASSIGNABLE_ROLE =
            "a2000000-0000-0000-0000-000000000003";
    private static final String FOREIGN_ROLE =
            "a2000000-0000-0000-0000-000000000004";
    private static final String USER_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000001";
    private static final String USER_WRITE_PERMISSION =
            "a3000000-0000-0000-0000-000000000002";
    private static final String ROLE_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000003";
    private static final String ROLE_WRITE_PERMISSION =
            "a3000000-0000-0000-0000-000000000004";
    private static final String PERMISSION_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000005";
    private static final String PERMISSION_ASSIGN_PERMISSION =
            "a3000000-0000-0000-0000-000000000006";
    private static final String AUDIT_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000007";

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static MockMvc mockMvc;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static String adminToken;

    @BeforeAll
    static void start() throws Exception {
        configureDatabase();
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        seedAdministrationContract();
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-administration-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean("springSecurityFilterChain", Filter.class))
                .build();
        adminToken = login(
                "phase2_tenant_a",
                "iam_admin",
                "phase2-admin-password");
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
    void enforcesPermissionsPaginationAndTenantBoundary() throws Exception {
        String ordinaryToken = login(
                "phase2_tenant_a",
                "ordinary_user",
                "phase2-ordinary-password");

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(ordinaryToken)))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B)
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.items[*].id", everyItem(not(FOREIGN_USER))));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(get("/api/v1/iam/roles")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.totalElements").value(3));

        mockMvc.perform(get("/api/v1/iam/permissions")
                        .header("Authorization", bearer(adminToken))
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items[*].code").value(
                        org.hamcrest.Matchers.hasItems(
                                "iam:user:read",
                                "iam:permission:assign",
                                "iam:audit:read")));

        mockMvc.perform(get("/api/v1/iam/members/" + ADMIN_USER + "/roles")
                        .header("Authorization", bearer(ordinaryToken)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get("/api/v1/iam/members/" + ADMIN_USER + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resourceId").value(ADMIN_USER))
                .andExpect(jsonPath("$.assignmentIds[0]").value(ADMIN_ROLE))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.tenantId").doesNotExist());

        mockMvc.perform(get("/api/v1/iam/members/" + FOREIGN_USER + "/roles")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/iam/members/" + java.util.UUID.randomUUID()
                                + "/roles")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/iam/roles/" + SYSTEM_ROLE + "/permissions")
                        .header("Authorization", bearer(ordinaryToken)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(get("/api/v1/iam/roles/" + SYSTEM_ROLE + "/permissions")
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resourceId").value(SYSTEM_ROLE))
                .andExpect(jsonPath("$.assignmentIds").isEmpty())
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.systemRole").doesNotExist())
                .andExpect(jsonPath("$.tenantId").doesNotExist());

        mockMvc.perform(get("/api/v1/iam/roles/" + FOREIGN_ROLE + "/permissions")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get("/api/v1/iam/roles/" + java.util.UUID.randomUUID()
                                + "/permissions")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(patch("/api/v1/iam/members/" + FOREIGN_USER)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Must Stay Hidden","version":0}
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(patch("/api/v1/iam/members/" + ADMIN_USER)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"IAM Administrator Updated",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("self_service_not_allowed"));
    }

    @Test
    @Order(2)
    void createsMembersAndRevokesSessionsAfterAdministratorPasswordReset()
            throws Exception {
        MvcResult created = mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .header("X-Request-Id", "phase2-create-member")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":" New.Member@Example.COM ",
                                  "phoneNumber":"+8613800138000",
                                  "displayName":"New Member",
                                  "initialPassword":"new-member-phase2-password",
                                  "roleIds":["%s"]
                                }
                                """.formatted(ASSIGNABLE_ROLE)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username")
                        .value("new.member@example.com"))
                .andExpect(jsonPath("$.email")
                        .value("new.member@example.com"))
                .andExpect(jsonPath("$.phoneNumber")
                        .value("+8613800138000"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andReturn();
        String memberId = JsonPath.read(
                created.getResponse().getContentAsString(),
                "$.id");
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl,
                username,
                password)) {
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_A));
        }
        assertThat(singleInt("""
                SELECT count(*)
                FROM users
                WHERE id = '%s'::uuid
                  AND password_hash LIKE '{argon2id}%%'
                  AND username = 'new.member@example.com'
                  AND email = 'new.member@example.com'
                  AND phone_number = '+8613800138000'
                """.formatted(memberId))).isOne();
        assertThat(singleInt("""
                SELECT count(*)
                FROM user_roles
                WHERE user_id = '%s'::uuid
                  AND role_id = '%s'::uuid
                """.formatted(memberId, ASSIGNABLE_ROLE))).isOne();
        assertThat(singleInt("""
                SELECT count(*)
                FROM password_credentials
                WHERE user_id = '%s'::uuid
                """.formatted(memberId))).isZero();
        String createdToken = loginWithEmail(
                "phase2_tenant_a",
                "NEW.MEMBER@EXAMPLE.COM",
                "new-member-phase2-password");
        assertThat(login(
                "phase2_tenant_a",
                "NEW.MEMBER@EXAMPLE.COM",
                "new-member-phase2-password")).isNotBlank();
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"phase2_tenant_a",
                                  "email":"new.member@example.com",
                                  "username":"new.member@example.com",
                                  "password":"new-member-phase2-password"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(patch("/api/v1/iam/members/" + memberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Renamed Member",
                                  "phoneNumber":"+14155552671",
                                  "version":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Renamed Member"))
                .andExpect(jsonPath("$.phoneNumber").value("+14155552671"))
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(patch("/api/v1/iam/members/" + memberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"must.remain.immutable@example.com",
                                  "displayName":"Renamed Member",
                                  "version":1
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(patch("/api/v1/iam/members/" + memberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "username":"must.remain.immutable@example.com",
                                  "displayName":"Renamed Member",
                                  "version":1
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(patch("/api/v1/iam/members/" + memberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Renamed Member",
                                  "phoneNumber":"invalid-phone",
                                  "version":1
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        String adminResetCredential = issueResetCredential(memberId);
        mockMvc.perform(put("/api/v1/iam/members/" + memberId + "/password")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"123456",
                                  "version":1
                                }
                                """))
                .andExpect(status().isNoContent());
        assertTenantCredentialInvalid(adminResetCredential);

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(createdToken)))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"phase2_tenant_a",
                                  "email":"new.member@example.com",
                                  "password":"new-member-phase2-password"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));

        String resetToken = loginWithEmail(
                "phase2_tenant_a",
                "new.member@example.com",
                "123456");
        String selfChangeCredential = issueResetCredential(memberId);
        mockMvc.perform(put("/api/v1/auth/password")
                        .header("Authorization", bearer(resetToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "currentPassword":"wrong-current-password",
                                  "newPassword":"member-self-change-password"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));
        mockMvc.perform(put("/api/v1/auth/password")
                        .header("Authorization", bearer(resetToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "currentPassword":"123456",
                                  "newPassword":"   "
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        assertThat(singleInt("""
                SELECT count(*)
                FROM password_credentials
                WHERE user_id = '%s'::uuid
                  AND consumed_at IS NULL
                  AND revoked_at IS NULL
                """.formatted(memberId))).isOne();
        mockMvc.perform(put("/api/v1/auth/password")
                        .header("Authorization", bearer(resetToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "currentPassword":"123456",
                                  "newPassword":"member-self-change-password"
                                }
                                """))
                .andExpect(status().isNoContent());
        assertTenantCredentialInvalid(selfChangeCredential);
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(resetToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(memberId));
        loginWithEmail(
                "phase2_tenant_a",
                "New.Member@Example.Com",
                "member-self-change-password");

        mockMvc.perform(put("/api/v1/iam/members/" + memberId + "/password")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"stale-version-password",
                                  "version":1
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("optimistic_lock_conflict"));
        mockMvc.perform(put("/api/v1/iam/members/" + ADMIN_USER + "/password")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"must-not-reset-self-password",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("self_service_not_allowed"));
        mockMvc.perform(put("/api/v1/iam/members/" + FOREIGN_USER + "/password")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"must-not-cross-tenant-password",
                                  "version":0
                                }
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        mockMvc.perform(put("/api/v1/iam/members/" + UUID.randomUUID()
                                + "/password")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "newPassword":"unknown-member-password",
                                  "version":0
                                }
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"",
                                  "displayName":"",
                                  "initialPassword":"too-short",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"broken",
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));

        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"must.reject.password@example.com",
                                  "displayName":"Must Reject Password",
                                  "initialPassword":"valid-password-value",
                                  "roleIds":[],
                                  "password":"plaintext-must-not-bind"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"NEW.MEMBER@example.com",
                                  "displayName":"Duplicate",
                                  "initialPassword":"duplicate-account-password",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));

        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"must.not.assign.system.role@example.com",
                                  "displayName":"Forbidden Role",
                                  "initialPassword":"forbidden-role-password",
                                  "roleIds":["%s"]
                                }
                                """.formatted(SYSTEM_ROLE)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        String ordinaryToken = login(
                "phase2_tenant_a",
                "ordinary_user",
                "phase2-ordinary-password");
        mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(ordinaryToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"unauthorized.create@example.com",
                                  "displayName":"Unauthorized",
                                  "initialPassword":"unauthorized-password",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        String managedToken = login(
                "phase2_tenant_a",
                "managed_user",
                "phase2-managed-password");
        mockMvc.perform(put("/api/v1/iam/members/" + MANAGED_USER + "/status")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"DISABLED","version":0}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DISABLED"));

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(managedToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));
        assertThat(singleInt("""
                SELECT count(*)
                FROM auth_sessions
                WHERE user_id = '%s'::uuid
                  AND revoked_at IS NOT NULL
                """.formatted(MANAGED_USER))).isOne();

        mockMvc.perform(put("/api/v1/iam/members/" + MANAGED_USER + "/status")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"ACTIVE","version":1}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(managedToken)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @Order(3)
    void replacesAssignmentsIdempotentlyAndProtectsConcurrentAndSystemRoles()
            throws Exception {
        MvcResult created = mockMvc.perform(post("/api/v1/iam/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "code":"phase2_api_role",
                                  "name":"Phase 2 API Role",
                                  "description":"Integration role"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.systemRole").value(false))
                .andExpect(jsonPath("$.presetRole").value(false))
                .andExpect(jsonPath("$.version").value(0))
                .andReturn();
        String roleId = JsonPath.read(
                created.getResponse().getContentAsString(),
                "$.id");

        mockMvc.perform(patch("/api/v1/iam/roles/" + roleId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name":"Missing Version",
                                  "description":null
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(patch("/api/v1/iam/roles/" + roleId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name":"Renamed API Role",
                                  "description":"Updated",
                                  "version":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));

        String roleAssignment = """
                {
                  "ids":["%s"],
                  "version":0
                }
                """.formatted(ASSIGNABLE_ROLE);
        mockMvc.perform(put("/api/v1/iam/members/" + ORDINARY_USER + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(roleAssignment))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.assignmentIds[0]").value(ASSIGNABLE_ROLE));

        mockMvc.perform(put("/api/v1/iam/members/" + ORDINARY_USER + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":1
                                }
                                """.formatted(ASSIGNABLE_ROLE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));

        mockMvc.perform(put("/api/v1/iam/members/" + ORDINARY_USER + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ids":[],"version":0}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("optimistic_lock_conflict"));

        mockMvc.perform(put("/api/v1/iam/members/" + ORDINARY_USER + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":1
                                }
                                """.formatted(FOREIGN_ROLE)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(put("/api/v1/iam/roles/" + roleId + "/permissions")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":1
                                }
                                """.formatted(USER_READ_PERMISSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));

        mockMvc.perform(put("/api/v1/iam/roles/" + roleId + "/permissions")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":2
                                }
                                """.formatted(USER_READ_PERMISSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));

        mockMvc.perform(put("/api/v1/iam/roles/" + roleId + "/permissions")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ids":[],"version":1}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("optimistic_lock_conflict"));

        mockMvc.perform(patch("/api/v1/iam/roles/" + SYSTEM_ROLE)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name":"Dangerous Rewrite",
                                  "description":null,
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("system_role_protected"));

        mockMvc.perform(put("/api/v1/iam/roles/" + SYSTEM_ROLE + "/permissions")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ids":[],"version":0}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("system_role_protected"));
    }

    @Test
    @Order(4)
    void exposesTenantScopedFilteredAuditWithoutSensitiveDetails() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/iam/audit-logs")
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B)
                        .param("resourceType", "user")
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items[0].actorUserId").value(ADMIN_USER))
                .andReturn();

        String responseBody = result.getResponse().getContentAsString();
        assertThat(responseBody)
                .doesNotContain(
                        adminToken,
                        "phase2-admin-password",
                        "phase2-managed-password",
                        "new-member-phase2-password",
                        "admin-reset-member-password",
                        "member-self-change-password",
                        "plaintext-must-not-bind",
                        TENANT_B);
        List<Map<String, Object>> details =
                JsonPath.read(responseBody, "$.items[*].details");
        assertThat(details)
                .flatExtracting(item -> item.keySet())
                .noneMatch(key -> key.toLowerCase().matches(
                        ".*(password|secret|token|credential|email|phone|contact).*"));
        List<String> createdAt = JsonPath.read(responseBody, "$.items[*].createdAt");
        assertThat(createdAt).isSortedAccordingTo(java.util.Comparator.reverseOrder());

        mockMvc.perform(get("/api/v1/iam/audit-logs")
                        .header("Authorization", bearer(adminToken))
                        .param("action", "iam.user.updated")
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].action",
                        everyItem(org.hamcrest.Matchers.is("iam.user.updated"))));

        mockMvc.perform(get("/api/v1/iam/audit-logs")
                        .header("Authorization", bearer(adminToken))
                        .param("action", "iam.user.roles_replaced"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get("/api/v1/iam/audit-logs")
                        .header("Authorization", bearer(adminToken))
                        .param("action", "iam.role.permissions_replaced"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get("/api/v1/iam/audit-logs")
                        .header("Authorization", bearer(adminToken))
                        .param("action", "iam.user.updated")
                        .param("from", "2026-01-01T00:00:00Z")
                        .param("to", "2026-07-01T00:00:00Z"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
    }

    @Test
    @Order(5)
    void keepsPhoneLoginIdentitiesCanonicalUniqueAndSafelyImmutable()
            throws Exception {
        MvcResult emailMember = mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"optional.phone@example.com",
                                  "displayName":"Optional Phone",
                                  "initialPassword":"optional-phone-password",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.phoneNumber")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andReturn();
        String emailMemberId = JsonPath.read(
                emailMember.getResponse().getContentAsString(),
                "$.id");

        mockMvc.perform(patch("/api/v1/iam/members/" + emailMemberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Optional Phone",
                                  "phoneNumber":"+442071838750",
                                  "version":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phoneNumber")
                        .value("+442071838750"))
                .andExpect(jsonPath("$.version").value(1));
        login(
                "phase2_tenant_a",
                "+442071838750",
                "optional-phone-password");

        MvcResult phoneMember = mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "phoneNumber":"+33123456789",
                                  "displayName":"Phone Login",
                                  "initialPassword":"phone-login-password",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value("+33123456789"))
                .andExpect(jsonPath("$.email")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.phoneNumber").value("+33123456789"))
                .andReturn();
        String phoneMemberId = JsonPath.read(
                phoneMember.getResponse().getContentAsString(),
                "$.id");

        login(
                "phase2_tenant_a",
                "+33123456789",
                "phone-login-password");

        mockMvc.perform(patch("/api/v1/iam/members/" + phoneMemberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Phone Login",
                                  "phoneNumber":"+33123456780",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));

        mockMvc.perform(patch("/api/v1/iam/members/" + phoneMemberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Phone Login",
                                  "phoneNumber":"",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));

        MvcResult duplicateTarget = mockMvc.perform(post("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email":"duplicate.phone@example.com",
                                  "displayName":"Duplicate Phone",
                                  "initialPassword":"duplicate-phone-password",
                                  "roleIds":[]
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        String duplicateTargetId = JsonPath.read(
                duplicateTarget.getResponse().getContentAsString(),
                "$.id");

        mockMvc.perform(patch("/api/v1/iam/members/" + duplicateTargetId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Duplicate Phone",
                                  "phoneNumber":"+442071838750",
                                  "version":0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));

        mockMvc.perform(patch("/api/v1/iam/members/" + emailMemberId)
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName":"Optional Phone",
                                  "phoneNumber":"",
                                  "version":1
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phoneNumber")
                        .value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.version").value(2));

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"phase2_tenant_a",
                                  "username":"+442071838750",
                                  "password":"optional-phone-password"
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));
        loginWithEmail(
                "phase2_tenant_a",
                "optional.phone@example.com",
                "optional-phone-password");
    }

    @Test
    @Order(6)
    void filtersMembersServerSideWithoutTenantOrLikeWildcardLeakage()
            throws Exception {
        try (Connection connection =
                DriverManager.getConnection(jdbcUrl, username, password)) {
            insertCanonicalUser(
                    connection,
                    FILTER_LITERAL_USER,
                    TENANT_A,
                    "literal@example.com",
                    "+8613800138090",
                    "Literal %_\\ Member",
                    "DISABLED");
            insertCanonicalUser(
                    connection,
                    FILTER_ALPHA_USER,
                    TENANT_A,
                    "alpha@example.com",
                    "+8613800138091",
                    "Common Team",
                    "ACTIVE");
            insertCanonicalUser(
                    connection,
                    FILTER_BRAVO_USER,
                    TENANT_A,
                    "bravo@example.com",
                    "+8613800138092",
                    "Common Team",
                    "ACTIVE");
            insertCanonicalUser(
                    connection,
                    FILTER_FOREIGN_USER,
                    TENANT_B,
                    "literal@example.com",
                    "+8613800138090",
                    "Literal %_\\ Member",
                    "DISABLED");
            assignRole(
                    connection,
                    TENANT_A,
                    FILTER_LITERAL_USER,
                    ASSIGNABLE_ROLE);
            assignRole(
                    connection,
                    TENANT_B,
                    FILTER_FOREIGN_USER,
                    FOREIGN_ROLE);
        }

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "LITERAL@EXAMPLE.COM"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_LITERAL_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "%_\\"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_LITERAL_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "+8613800138090"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_LITERAL_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "MANAGED_USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(MANAGED_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "literal")
                        .param("status", "DISABLED")
                        .param("roleId", ASSIGNABLE_ROLE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_LITERAL_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "Common Team")
                        .param("page", "0")
                        .param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_ALPHA_USER));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "Common Team")
                        .param("page", "1")
                        .param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.items[0].id").value(
                        FILTER_BRAVO_USER));

        String unknownRole = UUID.randomUUID().toString();
        for (String roleId : List.of(unknownRole, FOREIGN_ROLE)) {
            mockMvc.perform(get("/api/v1/iam/members")
                            .header("Authorization", bearer(adminToken))
                            .param("roleId", roleId))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value(
                            "resource_not_found"));
        }

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "   "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("query", "x".repeat(101)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("status", "UNKNOWN"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));

        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(adminToken))
                        .param("roleId", "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));

        String ordinaryToken = login(
                "phase2_tenant_a",
                "ordinary_user",
                "phase2-ordinary-password");
        mockMvc.perform(get("/api/v1/iam/members")
                        .header("Authorization", bearer(ordinaryToken))
                        .param("query", "literal")
                        .param("status", "DISABLED")
                        .param("roleId", ASSIGNABLE_ROLE))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
    }

    @Test
    @Order(7)
    void letsEnterpriseAdministratorsDelegateTheirRoleToOtherMembers()
            throws Exception {
        mockMvc.perform(put("/api/v1/iam/members/" + FILTER_ALPHA_USER
                                + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":0
                                }
                                """.formatted(SYSTEM_ROLE)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(put("/api/v1/iam/members/" + FILTER_ALPHA_USER
                                + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":0
                                }
                                """.formatted(ADMIN_ROLE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignmentIds[0]").value(ADMIN_ROLE))
                .andExpect(jsonPath("$.version").value(1));

        mockMvc.perform(put("/api/v1/iam/members/" + FILTER_ALPHA_USER
                                + "/roles")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "ids":["%s"],
                                  "version":1
                                }
                                """.formatted(ASSIGNABLE_ROLE)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignmentIds[0]").value(
                        ASSIGNABLE_ROLE))
                .andExpect(jsonPath("$.version").value(2));
    }

    private static String login(
            String tenantCode,
            String loginUsername,
            String loginPassword) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"%s",
                                  "username":"%s",
                                  "password":"%s"
                                }
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

    private static String loginWithEmail(
            String tenantCode,
            String loginEmail,
            String loginPassword) throws Exception {
        String normalizedEmail = BusinessEmailAddress.normalize(loginEmail);
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"%s",
                                  "email":"%s",
                                  "password":"%s"
                                }
                                """.formatted(
                                tenantCode,
                                loginEmail,
                                loginPassword)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username")
                        .value(normalizedEmail))
                .andExpect(jsonPath("$.user.email")
                        .value(normalizedEmail))
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static int singleInt(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getInt(1);
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

    private static void seedAdministrationContract() throws Exception {
        String adminHash = hash("phase2-admin-password");
        String ordinaryHash = hash("phase2-ordinary-password");
        String managedHash = hash("phase2-managed-password");
        try (Connection connection =
                DriverManager.getConnection(jdbcUrl, username, password)) {
            try (Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        INSERT INTO tenants (id, code, name) VALUES
                          ('%s', 'phase2_tenant_a', 'Phase 2 Tenant A'),
                          ('%s', 'phase2_tenant_b', 'Phase 2 Tenant B')
                        ON CONFLICT (id) DO NOTHING
                        """.formatted(TENANT_A, TENANT_B));
            }
            insertUser(
                    connection,
                    ADMIN_USER,
                    TENANT_A,
                    "iam_admin",
                    "IAM Administrator",
                    adminHash);
            insertUser(
                    connection,
                    ORDINARY_USER,
                    TENANT_A,
                    "ordinary_user",
                    "Ordinary User",
                    ordinaryHash);
            insertUser(
                    connection,
                    MANAGED_USER,
                    TENANT_A,
                    "managed_user",
                    "Managed User",
                    managedHash);
            insertUser(
                    connection,
                    FOREIGN_USER,
                    TENANT_B,
                    "foreign_user",
                    "Foreign User",
                    ordinaryHash);
            try (Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        INSERT INTO roles (
                            id, tenant_id, code, name, system_role
                        ) VALUES
                          ('%s', '%s', 'tenant_admin', 'Enterprise Administrator', true),
                          ('%s', '%s', 'system_owner', 'System Owner', true),
                          ('%s', '%s', 'assignable', 'Assignable', false),
                          ('%s', '%s', 'foreign_role', 'Foreign Role', false)
                        ON CONFLICT (id) DO NOTHING
                        """.formatted(
                        ADMIN_ROLE, TENANT_A,
                        SYSTEM_ROLE, TENANT_A,
                        ASSIGNABLE_ROLE, TENANT_A,
                        FOREIGN_ROLE, TENANT_B));
                statement.executeUpdate("""
                        INSERT INTO permissions (id, code, module, name) VALUES
                          ('%s', 'iam:user:read', 'iam', 'Read members'),
                          ('%s', 'iam:user:write', 'iam', 'Write members'),
                          ('%s', 'iam:role:read', 'iam', 'Read roles'),
                          ('%s', 'iam:role:write', 'iam', 'Write roles'),
                          ('%s', 'iam:permission:read', 'iam', 'Read permissions'),
                          ('%s', 'iam:permission:assign', 'iam', 'Assign permissions'),
                          ('%s', 'iam:audit:read', 'iam', 'Read audit logs')
                        ON CONFLICT (id) DO NOTHING
                        """.formatted(
                        USER_READ_PERMISSION,
                        USER_WRITE_PERMISSION,
                        ROLE_READ_PERMISSION,
                        ROLE_WRITE_PERMISSION,
                        PERMISSION_READ_PERMISSION,
                        PERMISSION_ASSIGN_PERMISSION,
                        AUDIT_READ_PERMISSION));
                statement.executeUpdate("""
                        INSERT INTO user_roles (tenant_id, user_id, role_id)
                        VALUES ('%s', '%s', '%s')
                        ON CONFLICT (user_id, role_id) DO NOTHING
                        """.formatted(TENANT_A, ADMIN_USER, ADMIN_ROLE));
                statement.executeUpdate("""
                        INSERT INTO role_permissions (
                            tenant_id, role_id, permission_id
                        ) VALUES
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s'),
                          ('%s', '%s', '%s')
                        ON CONFLICT (role_id, permission_id) DO NOTHING
                        """.formatted(
                        TENANT_A, ADMIN_ROLE, USER_READ_PERMISSION,
                        TENANT_A, ADMIN_ROLE, USER_WRITE_PERMISSION,
                        TENANT_A, ADMIN_ROLE, ROLE_READ_PERMISSION,
                        TENANT_A, ADMIN_ROLE, ROLE_WRITE_PERMISSION,
                        TENANT_A, ADMIN_ROLE, PERMISSION_READ_PERMISSION,
                        TENANT_A, ADMIN_ROLE, PERMISSION_ASSIGN_PERMISSION,
                        TENANT_A, ADMIN_ROLE, AUDIT_READ_PERMISSION));
            }
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_A));
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_B));
        }
    }

    private static void insertUser(
            Connection connection,
            String id,
            String tenantId,
            String userName,
            String displayName,
            String passwordHash) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (
                    id, tenant_id, username, display_name, password_hash, status
                ) VALUES (?::uuid, ?::uuid, ?, ?, ?, 'ACTIVE')
                ON CONFLICT (id) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  status = 'ACTIVE'
                """)) {
            statement.setString(1, id);
            statement.setString(2, tenantId);
            statement.setString(3, userName);
            statement.setString(4, displayName);
            statement.setString(5, passwordHash);
            statement.executeUpdate();
        }
    }

    private static void insertCanonicalUser(
            Connection connection,
            String id,
            String tenantId,
            String email,
            String phoneNumber,
            String displayName,
            String status) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (
                    id, tenant_id, username, email, phone_number,
                    display_name, password_hash, status
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT (id) DO NOTHING
                """)) {
            statement.setString(1, id);
            statement.setString(2, tenantId);
            statement.setString(3, email);
            statement.setString(4, email);
            statement.setString(5, phoneNumber);
            statement.setString(6, displayName);
            statement.setString(7, hash("phase2-filter-password"));
            statement.setString(8, status);
            statement.executeUpdate();
        }
    }

    private static void assignRole(
            Connection connection,
            String tenantId,
            String userId,
            String roleId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO user_roles (tenant_id, user_id, role_id)
                VALUES (?::uuid, ?::uuid, ?::uuid)
                ON CONFLICT (user_id, role_id) DO NOTHING
                """)) {
            statement.setString(1, tenantId);
            statement.setString(2, userId);
            statement.setString(3, roleId);
            statement.executeUpdate();
        }
    }

    private static String hash(String raw) {
        return "{bcrypt}" + new BCryptPasswordEncoder(4).encode(raw);
    }

    private static String issueResetCredential(String userId) throws Exception {
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/iam/members/"
                                        + userId
                                        + "/password-credentials")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"purpose":"PASSWORD_RESET"}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.token");
    }

    private static void assertTenantCredentialInvalid(String token)
            throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "token":"%s",
                                  "newPassword":"must-not-redeem-old-token"
                                }
                                """.formatted(token)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code")
                        .value("invalid_password_credential"))
                .andExpect(jsonPath("$.message")
                        .value("Credential is invalid or expired"));
    }

    private static void configureDatabase() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = requiredEnvironment("ERP_TEST_DB_USER");
            password = requiredEnvironment("ERP_TEST_DB_PASSWORD");
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_iam_phase2_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
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

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    name + " is required when ERP_TEST_DB_URL is set");
        }
        return value;
    }
}
