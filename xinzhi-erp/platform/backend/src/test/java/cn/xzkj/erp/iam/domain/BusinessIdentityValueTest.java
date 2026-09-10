package cn.xzkj.erp.iam.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class BusinessIdentityValueTest {

    @Test
    void normalizesBusinessEmailWithLocaleRootSemantics() {
        assertThat(BusinessEmailAddress.normalize(
                " Employee.Name+ERP@Example.COM "))
                .isEqualTo("employee.name+erp@example.com");
    }

    @Test
    void rejectsUnsupportedOrAmbiguousEmailShapes() {
        assertThatThrownBy(() -> BusinessEmailAddress.normalize("employee"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> BusinessEmailAddress.normalize(
                ".employee@example.com"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> BusinessEmailAddress.normalize(
                "employee..name@example.com"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> BusinessEmailAddress.normalize(
                "employee@example"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void normalizesOptionalE164PhoneWithoutMakingItAnIdentity() {
        assertThat(E164PhoneNumber.normalizeNullable(null)).isNull();
        assertThat(E164PhoneNumber.normalizeNullable("   ")).isNull();
        assertThat(E164PhoneNumber.normalizeNullable(" +8613800138000 "))
                .isEqualTo("+8613800138000");
        assertThatThrownBy(() ->
                E164PhoneNumber.normalizeNullable("13800138000"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                E164PhoneNumber.normalizeNullable("+0123456789"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
