package cn.xzkj.erp.order.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class BuyerReferenceSanitizerTest {
    @Test
    void redactsContactAndCredentialShapesButKeepsOpaqueReferences() {
        assertThat(BuyerReferenceSanitizer.sanitize("buyer@example.test / +86 138-0013-8000"))
                .doesNotContain("buyer@example.test", "138-0013-8000")
                .contains("[REDACTED_EMAIL]", "[REDACTED_PHONE]");
        assertThat(BuyerReferenceSanitizer.sanitize("buyer-ref_123")).isEqualTo("buyer-ref_123");
        assertThat(BuyerReferenceSanitizer.sanitize("secret=plain-value"))
                .doesNotContain("plain-value");
    }
}
