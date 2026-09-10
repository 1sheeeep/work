package cn.xzkj.erp.order.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class OrderLineTest {

    @Test
    void customAmountIsNotAProductLineAndCannotEnterSkuMatching() {
        OrderLine line = OrderLine.customAmount(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "gid://shopify/LineItem/1001",
                "Rush handling fee",
                2,
                1_500,
                "USD");

        assertThat(line.getLineKind()).isEqualTo(OrderLineKind.CUSTOM_AMOUNT);
        assertThat(line.getSkuId()).isNull();
        assertThat(line.getExternalListingRef()).isNull();
        assertThat(line.getExternalVariantRef()).isNull();
        assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.UNMATCHED);
    }

    @Test
    void regularConstructorsContinueToCreateProductLines() {
        OrderLine line = new OrderLine(
                UUID.randomUUID(),
                UUID.randomUUID(),
                null,
                "line-1",
                "Product",
                1,
                2_000,
                "USD");

        assertThat(line.getLineKind()).isEqualTo(OrderLineKind.PRODUCT);
    }
}
