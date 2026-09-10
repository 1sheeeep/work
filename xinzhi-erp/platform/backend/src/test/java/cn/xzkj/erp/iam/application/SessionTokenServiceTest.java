package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class SessionTokenServiceTest {

    @Test
    void issuesOpaqueTokenAndStoresOnlyDeterministicDigest() {
        Instant now = Instant.parse("2026-07-28T12:00:00Z");
        SecureRandom random = new FixedSecureRandom();
        SessionTokenService service = new SessionTokenService(
                random,
                Clock.fixed(now, ZoneOffset.UTC),
                Duration.ofHours(8));

        SessionTokenService.IssuedToken issued = service.issue();

        assertThat(issued.rawValue()).hasSize(43).doesNotContain("=");
        assertThat(issued.hash()).hasSize(64).doesNotContain(issued.rawValue());
        assertThat(service.hash(issued.rawValue())).isEqualTo(issued.hash());
        assertThat(issued.expiresAt()).isEqualTo(now.plus(Duration.ofHours(8)));
    }

    private static final class FixedSecureRandom extends SecureRandom {

        @Override
        public void nextBytes(byte[] bytes) {
            for (int index = 0; index < bytes.length; index++) {
                bytes[index] = (byte) index;
            }
        }
    }
}
