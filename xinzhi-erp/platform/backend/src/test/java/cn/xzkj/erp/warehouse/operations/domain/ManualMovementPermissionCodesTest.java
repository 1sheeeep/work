package cn.xzkj.erp.warehouse.operations.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ManualMovementPermissionCodesTest {
    @Test
    void exposesOnlyTheApprovedManualMovementPermissions() {
        assertThat(ManualMovementPermissionCodes.ALL)
                .containsExactlyInAnyOrder(
                        "inventory.read",
                        "inventory.manual.write",
                        "inventory.manual.post",
                        "inventory.manual.approve",
                        "inventory.manual.configure",
                        "inventory.reverse");
    }
}
