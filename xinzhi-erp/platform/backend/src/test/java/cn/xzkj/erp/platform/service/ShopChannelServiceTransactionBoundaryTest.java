package cn.xzkj.erp.platform.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

class ShopChannelServiceTransactionBoundaryTest {

    @Test
    void projectionAndAuthorizationMethodsProvideAtomicAuditTransactions()
            throws NoSuchMethodException {
        assertThat(ShopChannelService.class
                .getMethod("get", ShopCenterActor.class, UUID.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
        assertThat(ShopChannelService.class
                .getMethod("authorizeShopify", ShopCenterActor.class, UUID.class)
                .isAnnotationPresent(Transactional.class)).isTrue();
    }
}
