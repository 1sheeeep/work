package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.SecurityAuditActions;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class LoginServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-28T12:00:00Z");
    private static final UUID TENANT_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");

    private final TenantRepository tenantRepository = mock(TenantRepository.class);
    private final UserAccountRepository userRepository = mock(UserAccountRepository.class);
    private final AuthSessionRepository sessionRepository = mock(AuthSessionRepository.class);
    private final PermissionRepository permissionRepository = mock(PermissionRepository.class);
    private final SecurityAuditRecorder auditRecorder = mock(SecurityAuditRecorder.class);
    private final PasswordHashingService passwordHashingService =
            mock(PasswordHashingService.class);
    private final SessionTokenService tokenService = mock(SessionTokenService.class);
    private final LoginThrottleService loginThrottleService =
            mock(LoginThrottleService.class);
    private LoginService service;

    @BeforeEach
    void setUp() {
        when(passwordHashingService.hashForStorage(any(char[].class)))
                .thenReturn("{bcrypt}dummy");
        service = new LoginService(
                tenantRepository,
                userRepository,
                sessionRepository,
                permissionRepository,
                auditRecorder,
                passwordHashingService,
                tokenService,
                loginThrottleService,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void createsTenantBoundSessionAndAuditsSuccessfulLogin() {
        TenantEntity tenant = mock(TenantEntity.class);
        UserAccountEntity user = mock(UserAccountEntity.class);
        when(tenant.getId()).thenReturn(TENANT_ID);
        when(tenant.getCode()).thenReturn("acme");
        when(tenant.getName()).thenReturn("Acme");
        when(tenant.getStatus()).thenReturn(TenantStatus.ACTIVE);
        when(user.getId()).thenReturn(USER_ID);
        when(user.getStatus()).thenReturn(AccountStatus.ACTIVE);
        when(user.getPasswordHash()).thenReturn("{bcrypt}stored");
        when(user.getUsername()).thenReturn("operator");
        when(user.getDisplayName()).thenReturn("Operator");
        when(tenantRepository.findByCode("acme")).thenReturn(Optional.of(tenant));
        when(userRepository.findByTenant_IdAndUsername(TENANT_ID, "operator"))
                .thenReturn(Optional.of(user));
        when(passwordHashingService.matches("correct-password", "{bcrypt}stored"))
                .thenReturn(true);
        when(loginThrottleService.currentLock(TENANT_ID, USER_ID))
                .thenReturn(Optional.empty());
        when(loginThrottleService.clearForSuccessfulLogin(TENANT_ID, USER_ID))
                .thenReturn(Optional.empty());
        when(tokenService.issue()).thenReturn(new SessionTokenService.IssuedToken(
                "raw-token",
                "hashed-token",
                NOW.plusSeconds(3600)));
        when(permissionRepository.findCodesByTenantIdAndUserId(TENANT_ID, USER_ID))
                .thenReturn(List.of("orders.read"));

        LoginResult result = service.login(command("correct-password"));

        assertThat(result.accessToken()).isEqualTo("raw-token");
        assertThat(result.tenantId()).isEqualTo(TENANT_ID);
        assertThat(result.tenantCode()).isEqualTo("acme");
        assertThat(result.tenantName()).isEqualTo("Acme");
        assertThat(result.permissions()).containsExactly("orders.read");
        ArgumentCaptor<AuthSessionEntity> session = ArgumentCaptor.forClass(AuthSessionEntity.class);
        verify(sessionRepository).save(session.capture());
        assertThat(session.getValue().getTenantId()).isEqualTo(TENANT_ID);
        assertThat(session.getValue().getTokenHash()).isEqualTo("hashed-token");
        assertThat(session.getValue().getTokenHash()).isNotEqualTo(result.accessToken());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().action()).isEqualTo(SecurityAuditActions.LOGIN_SUCCEEDED);
        assertThat(audit.getValue().tenantId()).isEqualTo(TENANT_ID);
    }

    @Test
    void rejectsUnknownTenantWithSameGenericErrorAndDummyHashWork() {
        when(tenantRepository.findByCode("acme")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login(command("wrong-password")))
                .isInstanceOf(InvalidLoginException.class)
                .hasMessage("Invalid tenant, username, or password");

        verify(passwordHashingService).matches("wrong-password", "{bcrypt}dummy");
        verify(sessionRepository, never()).save(any());
        verify(auditRecorder, never()).record(any());
        verify(tenantRepository, never()).saveAndFlush(any());
        verify(userRepository, never()).saveAndFlush(any());
    }

    @Test
    void auditsKnownTenantFailureWithoutCreatingSession() {
        TenantEntity tenant = mock(TenantEntity.class);
        when(tenant.getId()).thenReturn(TENANT_ID);
        when(tenant.getStatus()).thenReturn(TenantStatus.ACTIVE);
        when(tenantRepository.findByCode("acme")).thenReturn(Optional.of(tenant));
        when(userRepository.findByTenant_IdAndUsername(TENANT_ID, "operator"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login(command("wrong-password")))
                .isInstanceOf(InvalidLoginException.class);

        verify(sessionRepository, never()).save(any());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).record(audit.capture());
        assertThat(audit.getValue().action()).isEqualTo(SecurityAuditActions.LOGIN_FAILED);
        assertThat(audit.getValue().actorUserId()).isNull();
        assertThat(audit.getValue().details())
                .containsEntry("reason", "invalid_credentials_or_status");
    }

    @Test
    void lockedAccountStillPerformsStoredHashVerification() {
        TenantEntity tenant = mock(TenantEntity.class);
        UserAccountEntity user = mock(UserAccountEntity.class);
        when(tenant.getId()).thenReturn(TENANT_ID);
        when(tenant.getStatus()).thenReturn(TenantStatus.ACTIVE);
        when(user.getId()).thenReturn(USER_ID);
        when(user.getPasswordHash()).thenReturn("{bcrypt}stored");
        when(tenantRepository.findByCode("acme"))
                .thenReturn(Optional.of(tenant));
        when(userRepository.findByTenant_IdAndUsername(
                TENANT_ID,
                "operator")).thenReturn(Optional.of(user));
        when(loginThrottleService.currentLock(TENANT_ID, USER_ID))
                .thenReturn(Optional.of(
                        new LoginRateLimitedException(600)));

        assertThatThrownBy(() -> service.login(command("correct-password")))
                .isInstanceOf(LoginRateLimitedException.class)
                .hasMessage("Too many failed login attempts");

        verify(passwordHashingService)
                .matches("correct-password", "{bcrypt}stored");
        verify(loginThrottleService, never())
                .recordFailure(any(), any(), any());
        verify(sessionRepository, never()).save(any());
    }

    private static LoginCommand command(String password) {
        return new LoginCommand("acme", "operator", password, "request-1", "127.0.0.1");
    }

    @Test
    void revokedEnterpriseOrAccountCannotLoginEvenWithCorrectPassword() {
        for (TenantStatus tenantStatus : TenantStatus.values()) {
            for (AccountStatus accountStatus : AccountStatus.values()) {
                if (tenantStatus == TenantStatus.ACTIVE && accountStatus == AccountStatus.ACTIVE) {
                    continue;
                }
                TenantEntity tenant = mock(TenantEntity.class);
                UserAccountEntity user = mock(UserAccountEntity.class);
                when(tenant.getId()).thenReturn(TENANT_ID);
                when(tenant.getStatus()).thenReturn(tenantStatus);
                when(user.getId()).thenReturn(USER_ID);
                when(user.getStatus()).thenReturn(accountStatus);
                when(user.getPasswordHash()).thenReturn("{bcrypt}stored");
                when(tenantRepository.findByCode("acme")).thenReturn(Optional.of(tenant));
                when(userRepository.findByTenant_IdAndUsername(TENANT_ID, "operator"))
                        .thenReturn(Optional.of(user));
                when(passwordHashingService.matches("correct-password", "{bcrypt}stored"))
                        .thenReturn(true);

                assertThatThrownBy(() -> service.login(command("correct-password")))
                        .isInstanceOf(InvalidLoginException.class);
            }
        }
        verify(sessionRepository, never()).save(any());
        verify(tokenService, never()).issue();
        verify(tenantRepository, never()).saveAndFlush(any());
        verify(userRepository, never()).saveAndFlush(any());
    }
}
