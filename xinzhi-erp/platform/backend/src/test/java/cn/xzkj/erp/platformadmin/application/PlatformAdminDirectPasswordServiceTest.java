package cn.xzkj.erp.platformadmin.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import cn.xzkj.erp.platformadmin.security.PlatformAdminPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PlatformAdminDirectPasswordServiceTest {

    @Mock
    private SystemAdminRepository adminRepository;

    @Mock
    private PlatformAdminSessionRepository sessionRepository;

    @Mock
    private PlatformTenantSessionRepository tenantSessionRepository;

    @Mock
    private PasswordHashingService passwordHashingService;

    @Mock
    private SessionTokenService tokenService;

    @Mock
    private PlatformAdminLoginThrottleService throttleService;

    @Mock
    private PlatformAdminAuditRecorder auditRecorder;

    @Mock
    private PlatformAdminCredentialRepository credentialRepository;

    @Test
    void clearsBothInputsWhenCurrentPasswordIsWrong() {
        when(passwordHashingService.hashForStorage(any(char[].class)))
                .thenReturn("{argon2id}dummy");
        PlatformAdminAuthService service = new PlatformAdminAuthService(
                adminRepository,
                sessionRepository,
                tenantSessionRepository,
                passwordHashingService,
                tokenService,
                throttleService,
                auditRecorder,
                credentialRepository,
                Clock.fixed(
                        Instant.parse("2026-07-29T00:00:00Z"),
                        ZoneOffset.UTC));
        UUID adminId = UUID.randomUUID();
        SystemAdminEntity admin = org.mockito.Mockito.mock(
                SystemAdminEntity.class);
        when(adminRepository.findByIdForUpdate(adminId))
                .thenReturn(Optional.of(admin));
        when(admin.getStatus()).thenReturn(SystemAdminStatus.ACTIVE);
        when(admin.getPasswordHash()).thenReturn("{argon2id}stored");
        when(passwordHashingService.matches(any(), anyString()))
                .thenReturn(false);
        char[] currentPassword = "wrong-current-password".toCharArray();
        char[] newPassword = "new-password-value".toCharArray();

        assertThatThrownBy(() -> service.changeOwnPassword(
                        new PlatformAdminPrincipal(
                                UUID.randomUUID(),
                                Instant.parse("2026-07-29T08:00:00Z"),
                                adminId,
                                "system_admin",
                                "System Admin"),
                        currentPassword,
                        newPassword,
                        "direct-password-test",
                        "127.0.0.1"))
                .isInstanceOf(InvalidPlatformAdminLoginException.class);

        assertThat(currentPassword).containsOnly('\0');
        assertThat(newPassword).containsOnly('\0');
    }
}
