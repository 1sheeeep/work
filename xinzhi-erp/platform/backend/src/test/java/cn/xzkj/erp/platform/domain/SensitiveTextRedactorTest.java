package cn.xzkj.erp.platform.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SensitiveTextRedactorTest {

    @Test
    void redactsCommonSecretShapesAndRemovesLineBreaks() {
        String input = "remote failure\nAuthorization: Bearer token-123 api_key=key-456";

        String result = SensitiveTextRedactor.redactNullable(input);

        assertThat(result)
                .doesNotContain("token-123", "key-456", "\n")
                .contains("authorization=[REDACTED]", "api_key=[REDACTED]");
    }
}
