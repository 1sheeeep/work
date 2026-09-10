package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

class PasswordCredentialRedemptionCostTest {

    @Test
    void invalidTokenDoesNotInvokePasswordEncoder() {
        PasswordCredentialRepository credentials =
                mock(PasswordCredentialRepository.class);
        PasswordCredentialTokenService tokens =
                mock(PasswordCredentialTokenService.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        when(tokens.hashPresented(any(char[].class)))
                .thenReturn("a".repeat(64));
        when(credentials.findByTokenHashForUpdate("a".repeat(64)))
                .thenReturn(Optional.empty());
        PasswordCredentialService service = new PasswordCredentialService(
                mock(UserAccountRepository.class),
                credentials,
                mock(AuthSessionRepository.class),
                tokens,
                new PasswordHashingService(encoder),
                mock(SecurityAuditRecorder.class),
                Clock.systemUTC(),
                Duration.ofMinutes(30));
        char[] newPassword = "not-hashed-invalid-token".toCharArray();

        assertThatThrownBy(() -> service.redeem(
                        "invalid-token".toCharArray(),
                        newPassword,
                        "request",
                        "127.0.0.1"))
                .isExactlyInstanceOf(
                        InvalidPasswordCredentialException.class);

        verifyNoInteractions(encoder);
        assertThat(newPassword).containsOnly('\0');
    }
}
