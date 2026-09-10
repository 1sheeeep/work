package cn.xzkj.erp.supplier.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import cn.xzkj.erp.iam.domain.PermissionCode;

class SupplierPermissionCodesTest {
    @Test
    void retainedReadPermissionIsStableAndCanonical() {
        assertThat(new PermissionCode(SupplierPermissionCodes.READ).value())
                .isEqualTo("suppliers.read");
    }
}
