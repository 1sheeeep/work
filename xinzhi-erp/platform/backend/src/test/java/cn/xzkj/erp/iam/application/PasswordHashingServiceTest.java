package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

class PasswordHashingServiceTest {

    private final PasswordHashingService service =
            new PasswordHashingService(testPasswordEncoder());

    @Test
    void storesSaltedArgon2idAndClearsInput() {
        char[] firstInput = "a-long-test-password".toCharArray();
        char[] secondInput = "a-long-test-password".toCharArray();

        String first = service.hashForStorage(firstInput);
        String second = service.hashForStorage(secondInput);

        assertThat(first).startsWith("{argon2id}$argon2id$");
        assertThat(second).startsWith("{argon2id}$argon2id$").isNotEqualTo(first);
        assertThat(service.matches("a-long-test-password", first)).isTrue();
        assertThat(firstInput).containsOnly('\0');
        assertThat(secondInput).containsOnly('\0');
    }

    @Test
    void acceptsShortNonBlankPasswords() {
        char[] shortPassword = "123456".toCharArray();

        String stored = service.hashForStorage(shortPassword);

        assertThat(service.matches("123456", stored)).isTrue();
        assertThat(shortPassword).containsOnly('\0');
    }

    @Test
    void rejectsBlankPasswordsAndClearsInput() {
        char[] blankPassword = "   ".toCharArray();

        assertThatIllegalArgumentException()
                .isThrownBy(() -> service.hashForStorage(blankPassword));
        assertThat(blankPassword).containsOnly('\0');
    }

    @Test
    void failsClosedForMalformedOrUnsupportedStoredHash() {
        assertThat(service.matches("candidate-password", "plaintext-is-not-a-hash"))
                .isFalse();
        assertThat(service.matches("candidate-password", "{unknown}value"))
                .isFalse();
    }

    @Test
    void continuesToVerifyExistingBcryptHashes() {
        String existingHash = "{bcrypt}"
                + new BCryptPasswordEncoder(4).encode("existing-password");

        assertThat(service.matches("existing-password", existingHash)).isTrue();
        assertThat(service.matches("wrong-password", existingHash)).isFalse();
    }

    private static PasswordEncoder testPasswordEncoder() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(4);
        Argon2PasswordEncoder argon2id =
                new Argon2PasswordEncoder(16, 32, 1, 1024, 1);
        return new DelegatingPasswordEncoder(
                "argon2id",
                Map.of("argon2id", argon2id, "bcrypt", bcrypt));
    }
}
