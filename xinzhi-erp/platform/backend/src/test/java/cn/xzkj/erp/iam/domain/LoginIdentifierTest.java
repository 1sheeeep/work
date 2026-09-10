package cn.xzkj.erp.iam.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class LoginIdentifierTest {

    @Test
    void normalizesEmailAndMainlandChinaMobile() {
        assertThat(LoginIdentifier.normalizeRequired(" Admin@Example.com "))
                .isEqualTo(new LoginIdentifier.Normalized(
                        "admin@example.com",
                        "admin@example.com",
                        null));
        assertThat(LoginIdentifier.normalizeRequired("18002629295"))
                .isEqualTo(new LoginIdentifier.Normalized(
                        "+8618002629295",
                        null,
                        "+8618002629295"));
    }

    @Test
    void rejectsNonEmailAndNonPhoneValues() {
        assertThatThrownBy(() -> LoginIdentifier.normalizeRequired("admin"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
