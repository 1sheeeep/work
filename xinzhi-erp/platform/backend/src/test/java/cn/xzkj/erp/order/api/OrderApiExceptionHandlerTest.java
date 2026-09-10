package cn.xzkj.erp.order.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalTime;

import org.junit.jupiter.api.Test;

import cn.xzkj.erp.settings.general.OrderPullBlackoutException;

class OrderApiExceptionHandlerTest {

    @Test
    void quietPeriodConflictHasActionableSafeDetails() {
        var response = new OrderApiExceptionHandler().orderPullBlackout(
                new OrderPullBlackoutException(LocalTime.of(6, 0)));

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("order_pull_blackout");
        assertThat(response.getBody().details())
                .containsEntry("reason", "order_pull_blackout")
                .containsEntry("resumesAt", "06:00")
                .containsEntry("timeZone", "Asia/Shanghai");
    }
}
