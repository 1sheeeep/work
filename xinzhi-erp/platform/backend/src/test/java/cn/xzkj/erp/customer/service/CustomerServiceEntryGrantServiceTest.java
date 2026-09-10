package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.security.SecureRandom;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.ArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CustomerServiceEntryGrantServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-01T09:00:00Z");
    private static final String ORIGIN = "https://customer.example.test";
    private static final UUID TENANT_ID = UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString("20000000-0000-4000-8000-000000000001");
    private static final UUID SESSION_ID = UUID.fromString("30000000-0000-4000-8000-000000000001");

    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final SecureRandom random = new ZeroSecureRandom();
    private final SessionTokenService tokens = new SessionTokenService(random, clock, Duration.ofHours(8));
    private CustomerServiceEntryGrantService service;
    private AuthSessionEntity session;
    private TenantEntity tenant;
    private Optional<AuthSessionEntity> sessionLookup;
    private Optional<PlatformTenantSessionEntity> platformSessionLookup;
    private Optional<CustomerServiceEntryGrantEntity> grantLookup;
    private List<String> permissionCodes;
    private List<String> allPermissionCodes;
    private boolean enterpriseAdministrator;
    private CustomerServiceEntryGrantEntity savedGrant;
    private List<CustomerServiceShopProjectionProvider.ShopProjection> shopProjections;
    private final List<SecurityAuditEvent> auditEvents = new ArrayList<>();
    private TenantEntitlementService entitlements;
    private UserApplicationAccessService applicationAccess;

    @BeforeEach
    void setUp() {
        tenant = new TenantEntity(TENANT_ID, "test", "Synthetic Tenant", TenantStatus.ACTIVE, NOW);
        UserAccountEntity user = new UserAccountEntity(
                USER_ID, tenant, "agent@example.test", null, "Synthetic Agent", AccountStatus.ACTIVE, NOW);
        session = new AuthSessionEntity(
                SESSION_ID, TENANT_ID, user, "session-hash", NOW.plus(Duration.ofMinutes(20)), NOW);
        sessionLookup = Optional.empty();
        platformSessionLookup = Optional.empty();
        grantLookup = Optional.empty();
        permissionCodes = List.of();
        allPermissionCodes = List.of();
        enterpriseAdministrator = false;
        savedGrant = null;
        shopProjections = List.of();
        auditEvents.clear();
        entitlements = mock(TenantEntitlementService.class);
        applicationAccess = mock(UserApplicationAccessService.class);
        when(entitlements.applicationEnabled(TENANT_ID, "CHAT")).thenReturn(true);
        when(applicationAccess.applicationAccessible(TENANT_ID, USER_ID, "CHAT"))
                .thenReturn(true);
        CustomerServiceEntryGrantRepository grants = proxy(
                CustomerServiceEntryGrantRepository.class,
                (method, args) -> {
                    if (method.equals("save")) {
                        savedGrant = (CustomerServiceEntryGrantEntity) args[0];
                        return savedGrant;
                    }
                    if (method.equals("findForConsumptionByTokenHash") || method.equals("findByTokenHash")) return grantLookup;
                    throw new UnsupportedOperationException(method);
                });
        AuthSessionRepository sessions = proxy(
                AuthSessionRepository.class,
                (method, args) -> {
                    if (method.equals("findByIdAndTenantIdAndUser_Id")) return sessionLookup;
                    throw new UnsupportedOperationException(method);
                });
        PlatformTenantSessionRepository platformSessions = proxy(
                PlatformTenantSessionRepository.class,
                (method, args) -> {
                    if (method.equals("findActiveByIdAndTenantIdAndSystemAdminId")) {
                        return platformSessionLookup;
                    }
                    throw new UnsupportedOperationException(method);
                });
        PermissionRepository permissions = proxy(
                PermissionRepository.class,
                (method, args) -> {
                    if (method.equals("findCodesByTenantIdAndUserId")) return permissionCodes;
                    if (method.equals("findAllCodes")) return allPermissionCodes;
                    throw new UnsupportedOperationException(method);
                });
        CustomerServiceIdentityRoleProvider roles = proxy(
                CustomerServiceIdentityRoleProvider.class,
                (method, args) -> {
                    if (method.equals("isEnterpriseAdministrator")) {
                        return enterpriseAdministrator;
                    }
                    throw new UnsupportedOperationException(method);
                });
        SecurityAuditRecorder audits = auditEvents::add;
        service = new CustomerServiceEntryGrantService(
                grants, sessions, platformSessions, permissions, roles,
                audits, tokens,
                tenantId -> shopProjections,
                random, clock,
                ORIGIN, "production", Duration.ofMinutes(1), Duration.ofMinutes(15),
                entitlements, applicationAccess);
    }

    @Test
    void issuesHashOnlyGrantBoundToCurrentSessionAndConfiguredOrigin() {
        sessionLookup = Optional.of(session);

        var result = service.issue(principal(), ORIGIN, "request-1", "127.0.0.1");

        assertThat(result.grant()).hasSize(43).doesNotContain("=");
        assertThat(savedGrant.getTokenHash()).isEqualTo(tokens.hash(result.grant()));
        assertThat(savedGrant.getTokenHash()).doesNotContain(result.grant());
        assertThat(result.entryUrl()).isEqualTo(ORIGIN + "/api/v1/auth/erp/entry");
        assertThat(result.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(1)));
    }

    @Test
    void refusesToIssueGrantWhenEmployeeLacksChatApplicationAccess() {
        sessionLookup = Optional.of(session);
        when(applicationAccess.applicationAccessible(TENANT_ID, USER_ID, "CHAT"))
                .thenReturn(false);

        assertThatThrownBy(() -> service.issue(
                principal(), ORIGIN, "request-denied", "127.0.0.1"))
                .isInstanceOf(CustomerServiceEntryException.class);
        assertThat(savedGrant).isNull();
    }

    @Test
    void rechecksChatApplicationAccessBeforeRedeemingGrant() {
        sessionLookup = Optional.of(session);
        var issued = service.issue(principal(), ORIGIN, "request-issued", "127.0.0.1");
        grantLookup = Optional.of(savedGrant);
        permissionCodes = List.of("customer_service.read");
        when(applicationAccess.applicationAccessible(TENANT_ID, USER_ID, "CHAT"))
                .thenReturn(false);

        assertThatThrownBy(() -> service.redeem(
                issued.grant(), TENANT_ID, USER_ID, ORIGIN,
                "request-redeem", "127.0.0.1"))
                .isInstanceOf(CustomerServiceEntryException.class);
        assertThat(savedGrant.getConsumedAt()).isNull();
    }

    @Test
    void redeemsOnceAndReturnsCurrentRestrictedIdentity() {
        String rawGrant = "a".repeat(43);
        CustomerServiceEntryGrantEntity grant = grant(rawGrant, NOW.plusSeconds(30));
        grantLookup = Optional.of(grant);
        permissionCodes = List.of("customer_service.read", "customer_service.conversation.reply");
        shopProjections = List.of(new CustomerServiceShopProjectionProvider.ShopProjection(
                UUID.fromString("50000000-0000-4000-8000-000000000001"),
                "ERP Shopify Store",
                "erp-store.myshopify.com",
                "ACTIVE",
                "AUTHORIZED",
                true,
                "XZ_ERP_APP"));

        var result = service.redeem(rawGrant, TENANT_ID, USER_ID, ORIGIN, null, "127.0.0.1");

        assertThat(grant.getConsumedAt()).isEqualTo(NOW);
        assertThat(result.tenantId()).isEqualTo(TENANT_ID);
        assertThat(result.subjectId()).isEqualTo(USER_ID);
        assertThat(result.permissions()).containsExactly(
                "customer_service.read", "customer_service.conversation.reply");
        assertThat(result.systemAdmin()).isFalse();
        assertThat(result.shops()).containsExactlyElementsOf(shopProjections);
        assertThat(result.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(15)));
        assertThatThrownBy(() -> service.redeem(
                rawGrant, TENANT_ID, USER_ID, ORIGIN, null, "127.0.0.1"))
                .isInstanceOf(CustomerServiceEntryException.class);
    }

    @Test
    void validatesConsumedGrantButRejectsLogoutAndUnconsumedGrant() {
        String raw = "a".repeat(43);
        var entry = grant(raw, NOW.plusSeconds(30));
        grantLookup = Optional.of(entry);
        permissionCodes = List.of("customer_service.read");
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
        entry.consume(NOW);
        assertThat(service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN).subjectId()).isEqualTo(USER_ID);
        assertThatThrownBy(() -> service.validateSession(raw, UUID.randomUUID(), USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, "https://wrong.example.test"))
                .isInstanceOf(CustomerServiceEntryException.class);
        session.revoke(NOW);
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
    }

    @Test
    void validationRejectsRevokedApplicationPermissionAndExpiredBusinessSession() {
        String raw = "a".repeat(43);
        var entry = grant(raw, NOW.plusSeconds(30));
        grantLookup = Optional.of(entry);
        entry.consume(NOW);
        permissionCodes = List.of("customer_service.read");
        when(applicationAccess.applicationAccessible(TENANT_ID, USER_ID, "CHAT")).thenReturn(false);
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
        when(applicationAccess.applicationAccessible(TENANT_ID, USER_ID, "CHAT")).thenReturn(true);
        permissionCodes = List.of();
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
        permissionCodes = List.of("customer_service.read");
        var old = grant(raw, NOW.minusSeconds(900));
        old.consume(NOW.minusSeconds(901));
        grantLookup = Optional.of(old);
        assertThatThrownBy(() -> service.validateSession(raw, TENANT_ID, USER_ID, ORIGIN))
                .isInstanceOf(CustomerServiceEntryException.class);
    }

    @Test
    void issuesAndRedeemsForSystemAdministratorTenantSession() {
        UUID adminId = UUID.fromString("60000000-0000-4000-8000-000000000001");
        SystemAdminEntity admin = new SystemAdminEntity(
                adminId, "admin@example.test", "System Administrator", NOW);
        admin.initializePassword("password-hash", SystemAdminStatus.ACTIVE, NOW);
        PlatformAdminSessionEntity baseSession = new PlatformAdminSessionEntity(
                UUID.fromString("70000000-0000-4000-8000-000000000001"),
                admin, "base-session-hash", NOW.plus(Duration.ofMinutes(20)), NOW);
        PlatformTenantSessionEntity tenantSession = new PlatformTenantSessionEntity(
                SESSION_ID, baseSession, admin, tenant, "tenant-session-hash",
                NOW.plus(Duration.ofMinutes(20)), NOW);
        platformSessionLookup = Optional.of(tenantSession);
        allPermissionCodes = List.of(
                "customer_service.read", "customer_service.conversation.reply");

        var issued = service.issue(
                new ErpPrincipal(
                        SESSION_ID, tenantSession.getExpiresAt(), TENANT_ID,
                        "test", "Synthetic Tenant", null, admin.getUsername(),
                        admin.getEmail(), admin.getDisplayName(), adminId),
                ORIGIN, "request-admin", "127.0.0.1");

        assertThat(issued.userId()).isEqualTo(adminId);
        assertThat(savedGrant.getAuthSession()).isNull();
        assertThat(savedGrant.getPlatformTenantSession()).isSameAs(tenantSession);
        grantLookup = Optional.of(savedGrant);

        var redeemed = service.redeem(
                issued.grant(), TENANT_ID, adminId, ORIGIN, "request-redeem", "127.0.0.1");

        assertThat(redeemed.subjectId()).isEqualTo(adminId);
        assertThat(redeemed.email()).isEqualTo("admin@example.test");
        assertThat(redeemed.displayName()).isEqualTo("System Administrator");
        assertThat(redeemed.systemAdmin()).isTrue();
        assertThat(redeemed.permissions()).containsExactlyElementsOf(allPermissionCodes);
        assertThat(auditEvents)
                .extracting(SecurityAuditEvent::actorSystemAdminId)
                .containsOnly(adminId);
    }

    @Test
    void marksTheSingleEnterpriseMainAccountAsSystemAdministrator() {
        String rawGrant = "d".repeat(43);
        grantLookup = Optional.of(grant(rawGrant, NOW.plusSeconds(30)));
        permissionCodes = List.of("customer_service.read");
        enterpriseAdministrator = true;

        var identity = service.redeem(
                rawGrant, TENANT_ID, USER_ID, ORIGIN, null, "127.0.0.1");

        assertThat(identity.systemAdmin()).isTrue();
    }

    @Test
    void rejectsExpiredCrossTenantCrossUserWrongOriginAndMissingPermission() {
        String rawGrant = "b".repeat(43);
        CustomerServiceEntryGrantEntity grant = grant(rawGrant, NOW.plusSeconds(30));
        grantLookup = Optional.of(grant);
        permissionCodes = List.of("inventory.read");

        UUID other = UUID.fromString("40000000-0000-4000-8000-000000000001");
        for (Runnable attempt : List.<Runnable>of(
                () -> service.redeem(rawGrant, other, USER_ID, ORIGIN, null, null),
                () -> service.redeem(rawGrant, TENANT_ID, other, ORIGIN, null, null),
                () -> service.redeem(rawGrant, TENANT_ID, USER_ID, "https://wrong.example.test", null, null),
                () -> service.redeem(rawGrant, TENANT_ID, USER_ID, ORIGIN, null, null))) {
            assertThatThrownBy(attempt::run).isInstanceOf(CustomerServiceEntryException.class);
            assertThat(grant.getConsumedAt()).isNull();
        }

        CustomerServiceEntryGrantEntity expired = grant("c".repeat(43), NOW.minusSeconds(1));
        grantLookup = Optional.of(expired);
        assertThatThrownBy(() -> service.redeem(
                "c".repeat(43), TENANT_ID, USER_ID, ORIGIN, null, null))
                .isInstanceOf(CustomerServiceEntryException.class);
    }

    private CustomerServiceEntryGrantEntity grant(String rawGrant, Instant expiresAt) {
        return new CustomerServiceEntryGrantEntity(
                UUID.randomUUID(), TENANT_ID, USER_ID, session, tokens.hash(rawGrant),
                ORIGIN, expiresAt, NOW.minusSeconds(1));
    }

    private ErpPrincipal principal() {
        return new ErpPrincipal(
                SESSION_ID, session.getExpiresAt(), TENANT_ID, "test", "Synthetic Tenant",
                USER_ID, "agent@example.test", "agent@example.test", "Synthetic Agent", null);
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, TestInvocation invocation) {
        return (T) Proxy.newProxyInstance(
                type.getClassLoader(),
                new Class<?>[] {type},
                (instance, method, args) -> {
                    if (method.getDeclaringClass() == Object.class) {
                        return switch (method.getName()) {
                            case "toString" -> type.getSimpleName() + "TestProxy";
                            case "hashCode" -> System.identityHashCode(instance);
                            case "equals" -> instance == args[0];
                            default -> null;
                        };
                    }
                    return invocation.invoke(method.getName(), args == null ? new Object[0] : args);
                });
    }

    @FunctionalInterface
    private interface TestInvocation {
        Object invoke(String method, Object[] args);
    }

    private static final class ZeroSecureRandom extends SecureRandom {
        @Override
        public void nextBytes(byte[] bytes) {
            java.util.Arrays.fill(bytes, (byte) 0);
        }
    }
}
