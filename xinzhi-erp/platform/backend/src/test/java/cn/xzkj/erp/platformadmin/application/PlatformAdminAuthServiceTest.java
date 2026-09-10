package cn.xzkj.erp.platformadmin.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.LoginRateLimitedException;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PlatformAdminAuthServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-07T11:00:00Z");
    private static final UUID ADMIN_ID =
            UUID.fromString("10000000-0000-0000-0000-000000000001");

    private final SystemAdminRepository adminRepository =
            mock(SystemAdminRepository.class);
    private final PlatformAdminSessionRepository sessionRepository =
            mock(PlatformAdminSessionRepository.class);
    private final PlatformTenantSessionRepository tenantSessionRepository =
            mock(PlatformTenantSessionRepository.class);
    private final PasswordHashingService passwordHashingService =
            mock(PasswordHashingService.class);
    private final SessionTokenService tokenService = mock(SessionTokenService.class);
    private final PlatformAdminLoginThrottleService throttleService =
            mock(PlatformAdminLoginThrottleService.class);
    private final PlatformAdminAuditRecorder auditRecorder =
            mock(PlatformAdminAuditRecorder.class);
    private final PlatformAdminCredentialRepository credentialRepository =
            mock(PlatformAdminCredentialRepository.class);
    private PlatformAdminAuthService service;

    @BeforeEach
    void setUp() {
        when(passwordHashingService.hashForStorage(any(char[].class)))
                .thenReturn("{bcrypt}dummy");
        service = new PlatformAdminAuthService(
                adminRepository,
                sessionRepository,
                tenantSessionRepository,
                passwordHashingService,
                tokenService,
                throttleService,
                auditRecorder,
                credentialRepository,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void verifiedPasswordClearsExistingLockAndCreatesSession() {
        SystemAdminEntity admin = mock(SystemAdminEntity.class);
        when(admin.getId()).thenReturn(ADMIN_ID);
        when(admin.getUsername()).thenReturn("platform-admin");
        when(admin.getDisplayName()).thenReturn("Platform Admin");
        when(admin.getStatus()).thenReturn(SystemAdminStatus.ACTIVE);
        when(admin.getPasswordHash()).thenReturn("{bcrypt}stored");
        when(adminRepository.findByUsernameIgnoreCase("platform-admin"))
                .thenReturn(Optional.of(admin));
        when(passwordHashingService.matches("correct-password", "{bcrypt}stored"))
                .thenReturn(true);
        when(throttleService.currentLock(ADMIN_ID))
                .thenReturn(Optional.of(new LoginRateLimitedException(600)));
        when(tokenService.issue()).thenReturn(new SessionTokenService.IssuedToken(
                "raw-token",
                "hashed-token",
                NOW.plusSeconds(3600)));

        PlatformAdminAuthService.LoginResult result = service.login(
                "platform-admin",
                "correct-password",
                "request-1",
                "127.0.0.1");

        assertThat(result.accessToken()).isEqualTo("raw-token");
        assertThat(result.admin().id()).isEqualTo(ADMIN_ID);
        verify(throttleService).clearForVerifiedLogin(ADMIN_ID);
        verify(throttleService, never()).recordFailure(any(), any());
        verify(sessionRepository).save(any(PlatformAdminSessionEntity.class));
        verify(auditRecorder).recordAtomically(any());
    }
}
