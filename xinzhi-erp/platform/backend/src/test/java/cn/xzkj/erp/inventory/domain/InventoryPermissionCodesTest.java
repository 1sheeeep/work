package cn.xzkj.erp.inventory.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class InventoryPermissionCodesTest {
    @Test
    void exposesOnlyTheApprovedV44Permissions() {
        assertThat(InventoryPermissionCodes.READ).isEqualTo("inventory.read");
        assertThat(InventoryPermissionCodes.ADJUST)
                .isEqualTo("inventory.adjust");
    }
}
