package cn.xzkj.erp.platformadmin.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.PasswordCredentialTokenService;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class PlatformAdminCredentialServiceTest {

    @Test
    void invalidTokenDoesNotInvokePasswordEncoder() {
        PlatformAdminCredentialRepository credentials =
                mock(PlatformAdminCredentialRepository.class);
        PasswordCredentialTokenService tokens =
                mock(PasswordCredentialTokenService.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        when(tokens.hashPresented(any(char[].class)))
                .thenReturn("a".repeat(64));
        when(credentials.findByTokenHashForUpdate("a".repeat(64)))
                .thenReturn(Optional.empty());
        PlatformAdminCredentialService service =
                new PlatformAdminCredentialService(
                        credentials,
                        mock(SystemAdminRepository.class),
                        mock(PlatformAdminSessionRepository.class),
                        mock(PlatformTenantSessionRepository.class),
                        tokens,
                        new PasswordHashingService(encoder),
                        mock(PlatformAdminAuditRecorder.class),
                        Clock.systemUTC(),
                        Duration.ofMinutes(30));
        char[] newPassword = "not-hashed-invalid-token".toCharArray();

        assertThatThrownBy(() -> service.redeem(
                        "invalid-token".toCharArray(),
                        newPassword,
                        "request",
                        "127.0.0.1"))
                .isExactlyInstanceOf(
                        InvalidPlatformAdminCredentialException.class);

        verifyNoInteractions(encoder);
        assertThat(newPassword).containsOnly('\0');
    }
}
