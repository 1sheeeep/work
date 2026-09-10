package cn.xzkj.erp.warehouse.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import cn.xzkj.erp.iam.domain.PermissionCode;

class WarehousePermissionCodesTest {
    @Test
    void permissionCodesAreStableAndUseTheCanonicalFormat() {
        assertThat(new PermissionCode(WarehousePermissionCodes.READ).value())
                .isEqualTo("warehouses.read");
        assertThat(new PermissionCode(WarehousePermissionCodes.WRITE).value())
                .isEqualTo("warehouses.write");
    }
}
