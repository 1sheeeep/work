package cn.xzkj.erp.iam.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import org.junit.jupiter.api.Test;

class PermissionCodeTest {

    @Test
    void acceptsStableModuleActionCodes() {
        assertThat(new PermissionCode("orders.read").value()).isEqualTo("orders.read");
        assertThat(new PermissionCode("inventory.stock.adjust").value())
                .isEqualTo("inventory.stock.adjust");
        assertThat(PlatformPermissionCodes.all())
                .allSatisfy(code -> assertThat(new PermissionCode(code).value()).isEqualTo(code));
    }

    @Test
    void rejectsAmbiguousOrUnstableCodes() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new PermissionCode("Orders:Read"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new PermissionCode("read"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new PermissionCode("orders.*"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new PermissionCode("shop.authorization:write"));
    }
}
