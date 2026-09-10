package cn.xzkj.erp.order.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class OrderPermissionCodesTest {
    @Test
    void exposesOnlyApprovedOrderPermissions() {
        assertThat(OrderPermissionCodes.all()).containsExactlyInAnyOrder("orders.read", "orders.write");
    }
}
