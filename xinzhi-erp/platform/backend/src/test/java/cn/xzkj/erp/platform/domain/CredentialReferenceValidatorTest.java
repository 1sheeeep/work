package cn.xzkj.erp.platform.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import org.junit.jupiter.api.Test;

class CredentialReferenceValidatorTest {

    @Test
    void acceptsOnlyOpaqueCredentialReferences() {
        assertThat(CredentialReferenceValidator.validateNullable(
                "vault://erp/test-tenant/shop-1#access-token"
        )).isEqualTo("vault://erp/test-tenant/shop-1#access-token");
        assertThat(CredentialReferenceValidator.validateNullable(
                "credential://tenant-a/platform/shop-1"
        )).isEqualTo("credential://tenant-a/platform/shop-1");
    }

    @Test
    void rejectsPlaintextAndReferencesWithQueryParameters() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> CredentialReferenceValidator.validateNullable("plain-secret-value"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> CredentialReferenceValidator.validateNullable(
                        "vault://tenant/shop?token=plain-secret-value"
                ));
    }

    @Test
    void returnsOnlyReferenceTypeForApiResponses() {
        assertThat(CredentialReferenceValidator.referenceType("vault://erp/shop"))
                .isEqualTo("VAULT");
        assertThat(CredentialReferenceValidator.referenceType(null)).isNull();
    }
}
