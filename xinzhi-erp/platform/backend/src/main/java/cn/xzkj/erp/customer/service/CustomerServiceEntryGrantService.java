package cn.xzkj.erp.customer.service;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.CUSTOMER_SERVICE_ENTRY_GRANT_ISSUED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.CUSTOMER_SERVICE_ENTRY_GRANT_REDEEMED;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerServiceEntryGrantService {

    public static final String REQUIRED_PERMISSION = "customer_service.read";
    private static final Pattern RAW_GRANT = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final int GRANT_BYTES = 32;

    private final CustomerServiceEntryGrantRepository grantRepository;
    private final AuthSessionRepository sessionRepository;
    private final PlatformTenantSessionRepository platformTenantSessionRepository;
    private final PermissionRepository permissionRepository;
    private final CustomerServiceIdentityRoleProvider identityRoleProvider;
    private final SecurityAuditRecorder auditRecorder;
    private final SessionTokenService tokenService;
    private final CustomerServiceShopProjectionProvider shopProjectionProvider;
    private final SecureRandom secureRandom;
    private final Clock clock;
    private final String configuredTargetOrigin;
    private final Duration grantTtl;
    private final Duration customerServiceSessionTtl;
    private final TenantEntitlementService entitlementService;
    private final UserApplicationAccessService userApplicationAccessService;

    public CustomerServiceEntryGrantService(
            CustomerServiceEntryGrantRepository grantRepository,
            AuthSessionRepository sessionRepository,
            PlatformTenantSessionRepository platformTenantSessionRepository,
            PermissionRepository permissionRepository,
            CustomerServiceIdentityRoleProvider identityRoleProvider,
            SecurityAuditRecorder auditRecorder,
            SessionTokenService tokenService,
            CustomerServiceShopProjectionProvider shopProjectionProvider,
            SecureRandom secureRandom,
            Clock clock,
            @Value("${erp.customer-service.entry-origin:}") String rawTargetOrigin,
            @Value("${erp.environment:local}") String environment,
            @Value("${erp.customer-service.grant-ttl:PT1M}") Duration grantTtl,
            @Value("${erp.customer-service.session-ttl:PT15M}") Duration customerServiceSessionTtl,
            TenantEntitlementService entitlementService,
            UserApplicationAccessService userApplicationAccessService) {
        this.grantRepository = grantRepository;
        this.sessionRepository = sessionRepository;
        this.platformTenantSessionRepository = platformTenantSessionRepository;
        this.permissionRepository = permissionRepository;
        this.identityRoleProvider = identityRoleProvider;
        this.auditRecorder = auditRecorder;
        this.tokenService = tokenService;
        this.shopProjectionProvider = shopProjectionProvider;
        this.secureRandom = secureRandom;
        this.clock = clock;
        this.configuredTargetOrigin = normalizeTargetOrigin(rawTargetOrigin, environment);
        this.grantTtl = validDuration(grantTtl, Duration.ofSeconds(15), Duration.ofMinutes(2));
        this.customerServiceSessionTtl = validDuration(
                customerServiceSessionTtl,
                Duration.ofMinutes(1),
                Duration.ofHours(1));
        this.entitlementService = entitlementService;
        this.userApplicationAccessService = userApplicationAccessService;
    }

    @Transactional
    public IssuedEntryGrant issue(
            ErpPrincipal principal,
            String requestedTargetOrigin,
            String requestId,
            String sourceIp) {
        if (configuredTargetOrigin == null) {
            throw CustomerServiceEntryException.unavailable();
        }
        if (!configuredTargetOrigin.equals(requestedTargetOrigin)) {
            throw CustomerServiceEntryException.invalidTarget();
        }
        if (principal == null || principal.sessionId() == null || principal.tenantId() == null) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        boolean accessible = principal.systemAdminId() != null
                ? entitlementService == null
                        || entitlementService.applicationEnabled(principal.tenantId(), "CHAT")
                : userApplicationAccessService == null
                        || userApplicationAccessService.applicationAccessible(
                                principal.tenantId(), principal.userId(), "CHAT");
        if (!accessible) {
            throw CustomerServiceEntryException.unavailable();
        }
        Instant now = clock.instant();
        UUID subjectId;
        Instant sessionExpiresAt;
        CustomerServiceEntryGrantEntity grant;
        String rawGrant = newRawGrant();
        if (principal.userId() != null && principal.systemAdminId() == null) {
            var session = sessionRepository.findByIdAndTenantIdAndUser_Id(
                            principal.sessionId(), principal.tenantId(), principal.userId())
                    .filter(value -> value.getRevokedAt() == null && value.getExpiresAt().isAfter(now))
                    .orElseThrow(CustomerServiceEntryException::invalidGrant);
            subjectId = principal.userId();
            sessionExpiresAt = session.getExpiresAt();
            grant = new CustomerServiceEntryGrantEntity(
                    UUID.randomUUID(), principal.tenantId(), subjectId, session,
                    tokenService.hash(rawGrant), configuredTargetOrigin,
                    earliest(now.plus(grantTtl), sessionExpiresAt), now);
        } else if (principal.userId() == null && principal.systemAdminId() != null) {
            var session = platformTenantSessionRepository
                    .findActiveByIdAndTenantIdAndSystemAdminId(
                            principal.sessionId(), principal.tenantId(), principal.systemAdminId(), now)
                    .orElseThrow(CustomerServiceEntryException::invalidGrant);
            subjectId = principal.systemAdminId();
            sessionExpiresAt = earliest(
                    session.getExpiresAt(), session.getPlatformSession().getExpiresAt());
            grant = new CustomerServiceEntryGrantEntity(
                    UUID.randomUUID(), principal.tenantId(), subjectId, session,
                    tokenService.hash(rawGrant), configuredTargetOrigin,
                    earliest(now.plus(grantTtl), sessionExpiresAt), now);
        } else {
            throw CustomerServiceEntryException.invalidGrant();
        }
        Instant expiresAt = grant.getExpiresAt();
        if (!expiresAt.isAfter(now.plusSeconds(5))) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        grantRepository.save(grant);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                CUSTOMER_SERVICE_ENTRY_GRANT_ISSUED,
                "customer_service_entry_grant",
                grant.getId().toString(),
                requestId,
                sourceIp,
                Map.of("target", "customer_service")));
        return new IssuedEntryGrant(
                rawGrant,
                configuredTargetOrigin + "/api/v1/auth/erp/entry",
                principal.tenantId(),
                subjectId,
                expiresAt);
    }

    @Transactional
    public RedeemedIdentity redeem(
            String rawGrant,
            UUID expectedTenantId,
            UUID expectedUserId,
            String targetOrigin,
            String requestId,
            String sourceIp) {
        if (configuredTargetOrigin == null) {
            throw CustomerServiceEntryException.unavailable();
        }
        if (rawGrant == null || !RAW_GRANT.matcher(rawGrant).matches()
                || expectedTenantId == null || expectedUserId == null
                || !configuredTargetOrigin.equals(targetOrigin)) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        Instant now = clock.instant();
        var grant = grantRepository.findForConsumptionByTokenHash(tokenService.hash(rawGrant))
                .orElseThrow(CustomerServiceEntryException::invalidGrant);
        if (grant.getConsumedAt() != null
                || !grant.getExpiresAt().isAfter(now)
                || !grant.getTenantId().equals(expectedTenantId)
                || !grant.getUserId().equals(expectedUserId)
                || !grant.getTargetOrigin().equals(targetOrigin)) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        boolean accessible = grant.getAuthSession() != null
                ? userApplicationAccessService == null
                        || userApplicationAccessService.applicationAccessible(
                                grant.getTenantId(), grant.getUserId(), "CHAT")
                : entitlementService == null
                        || entitlementService.applicationEnabled(
                                grant.getTenantId(), "CHAT");
        if (!accessible) {
            throw CustomerServiceEntryException.unavailable();
        }
        RedeemedIdentity identity = grant.getAuthSession() != null
                ? redeemTenantUser(grant, now)
                : redeemSystemAdmin(grant, now);
        List<String> permissions = identity.permissions();
        if (!permissions.contains(REQUIRED_PERMISSION)) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        grant.consume(now);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                grant.getTenantId(),
                grant.getAuthSession() == null ? null : grant.getUserId(),
                grant.getPlatformTenantSession() == null ? null : grant.getUserId(),
                CUSTOMER_SERVICE_ENTRY_GRANT_REDEEMED,
                "customer_service_entry_grant",
                grant.getId().toString(),
                requestId,
                sourceIp,
                Map.of("target", "customer_service")));
        return identity;
    }

    @Transactional(readOnly = true)
    public RedeemedIdentity validateSession(String rawGrant, UUID tenantId, UUID userId, String targetOrigin) {
        if (configuredTargetOrigin == null || !configuredTargetOrigin.equals(targetOrigin)
                || rawGrant == null || !RAW_GRANT.matcher(rawGrant).matches()) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        var grant = grantRepository.findByTokenHash(tokenService.hash(rawGrant))
                .orElseThrow(CustomerServiceEntryException::invalidGrant);
        Instant now = clock.instant();
        if (grant.getConsumedAt() == null || !grant.getTenantId().equals(tenantId)
                || !grant.getUserId().equals(userId) || !grant.getTargetOrigin().equals(targetOrigin)
                || !grant.getConsumedAt().plus(customerServiceSessionTtl).isAfter(now)) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        boolean accessible = grant.getAuthSession() != null
                ? userApplicationAccessService.applicationAccessible(tenantId, userId, "CHAT")
                : entitlementService.applicationEnabled(tenantId, "CHAT");
        if (!accessible) throw CustomerServiceEntryException.invalidGrant();
        var identity = grant.getAuthSession() != null ? redeemTenantUser(grant, now) : redeemSystemAdmin(grant, now);
        if (!identity.permissions().contains(REQUIRED_PERMISSION)) throw CustomerServiceEntryException.invalidGrant();
        return identity;
    }

    private RedeemedIdentity redeemTenantUser(
            CustomerServiceEntryGrantEntity grant,
            Instant now) {
        var session = grant.getAuthSession();
        var user = session.getUser();
        var tenant = user.getTenant();
        if (grant.getPlatformTenantSession() != null
                || session.getRevokedAt() != null
                || !session.getExpiresAt().isAfter(now)
                || !session.getTenantId().equals(grant.getTenantId())
                || !user.getId().equals(grant.getUserId())
                || user.getStatus() != AccountStatus.ACTIVE
                || tenant.getStatus() != TenantStatus.ACTIVE) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        List<String> permissions = permissionRepository.findCodesByTenantIdAndUserId(
                grant.getTenantId(), grant.getUserId());
        boolean systemAdmin = identityRoleProvider.isEnterpriseAdministrator(
                grant.getTenantId(), grant.getUserId());
        return new RedeemedIdentity(
                tenant.getId(), tenant.getCode(), user.getId(), user.getUsername(),
                user.getEmail(), user.getDisplayName(), systemAdmin,
                List.copyOf(permissions),
                shopProjectionProvider.shopsForTenant(grant.getTenantId()),
                earliest(session.getExpiresAt(), now.plus(customerServiceSessionTtl)));
    }

    private RedeemedIdentity redeemSystemAdmin(
            CustomerServiceEntryGrantEntity grant,
            Instant now) {
        PlatformTenantSessionEntity session = grant.getPlatformTenantSession();
        if (session == null) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        var admin = session.getSystemAdmin();
        var tenant = session.getTenant();
        var platformSession = session.getPlatformSession();
        if (session.getRevokedAt() != null
                || !session.getExpiresAt().isAfter(now)
                || platformSession.getRevokedAt() != null
                || !platformSession.getExpiresAt().isAfter(now)
                || !tenant.getId().equals(grant.getTenantId())
                || !admin.getId().equals(grant.getUserId())
                || !platformSession.getSystemAdmin().getId().equals(admin.getId())
                || admin.getStatus() != SystemAdminStatus.ACTIVE
                || tenant.getStatus() != TenantStatus.ACTIVE) {
            throw CustomerServiceEntryException.invalidGrant();
        }
        List<String> permissions = permissionRepository.findAllCodes();
        return new RedeemedIdentity(
                tenant.getId(), tenant.getCode(), admin.getId(), admin.getUsername(),
                admin.getEmail(), admin.getDisplayName(), true,
                List.copyOf(permissions),
                shopProjectionProvider.shopsForTenant(grant.getTenantId()),
                earliest(
                        earliest(session.getExpiresAt(), platformSession.getExpiresAt()),
                        now.plus(customerServiceSessionTtl)));
    }

    public String configuredTargetOrigin() {
        return configuredTargetOrigin;
    }

    private String newRawGrant() {
        byte[] bytes = new byte[GRANT_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static Duration validDuration(Duration value, Duration minimum, Duration maximum) {
        if (value == null || value.compareTo(minimum) < 0 || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException("Customer-service entry duration is outside the safe range");
        }
        return value;
    }

    private static Instant earliest(Instant left, Instant right) {
        return left.isBefore(right) ? left : right;
    }

    private static String normalizeTargetOrigin(String raw, String environment) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            URI uri = new URI(raw.strip());
            String scheme = uri.getScheme() == null
                    ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null
                    ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean loopback = host.equals("localhost")
                    || host.equals("127.0.0.1") || host.equals("::1");
            boolean local = "local".equalsIgnoreCase(environment);
            if (uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null
                    || (!uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                    || host.isEmpty()
                    || !("https".equals(scheme) || (local && loopback && "http".equals(scheme)))) {
                return null;
            }
            return new URI(scheme, null, host, uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException invalid) {
            return null;
        }
    }

    public record IssuedEntryGrant(
            String grant,
            String entryUrl,
            UUID tenantId,
            UUID userId,
            Instant expiresAt) {
    }

    public record RedeemedIdentity(
            UUID tenantId,
            String tenantCode,
            UUID subjectId,
            String username,
            String email,
            String displayName,
            boolean systemAdmin,
            List<String> permissions,
            List<CustomerServiceShopProjectionProvider.ShopProjection> shops,
            Instant expiresAt) {
    }
}
