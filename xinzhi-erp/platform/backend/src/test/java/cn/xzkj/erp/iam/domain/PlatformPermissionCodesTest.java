package cn.xzkj.erp.iam.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PlatformPermissionCodesTest {

    @Test
    void exposesExactShopCenterContractWithoutImplicitGrantSemantics() {
        assertThat(PlatformPermissionCodes.all())
                .containsExactlyInAnyOrder(
                        "platform:read",
                        "platform:write",
                        "shop:read",
                        "shop:write",
                        "shop:authorization:write",
                        "shop:sync:read",
                        "shop:sync:write");
    }
}
