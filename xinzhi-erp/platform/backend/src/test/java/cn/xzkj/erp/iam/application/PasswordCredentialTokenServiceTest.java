package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.SecureRandom;
import org.junit.jupiter.api.Test;

class PasswordCredentialTokenServiceTest {

    @Test
    void generatesOpaqueTokenPersistsOnlyHashAndClearsPresentedInput() {
        PasswordCredentialTokenService service =
                new PasswordCredentialTokenService(new FixedSecureRandom());

        PasswordCredentialTokenService.GeneratedToken generated =
                service.generate();
        char[] presented = generated.rawToken().toCharArray();

        assertThat(generated.rawToken()).hasSize(43).doesNotContain("=");
        assertThat(generated.tokenHash())
                .hasSize(64)
                .doesNotContain(generated.rawToken());
        assertThat(service.hashPresented(presented))
                .isEqualTo(generated.tokenHash());
        assertThat(presented).containsOnly('\0');
    }

    private static final class FixedSecureRandom extends SecureRandom {

        @Override
        public void nextBytes(byte[] bytes) {
            for (int index = 0; index < bytes.length; index++) {
                bytes[index] = (byte) (index + 1);
            }
        }
    }
}
