package cn.xzkj.erp.order.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class TenantOrderTest {
    @Test
    void followsApprovedReviewAndHoldPaths() {
        TenantOrder order = order();
        assertThat(order.transition(OrderStatus.REVIEW_PENDING, null)).isTrue();
        assertThat(order.transition(OrderStatus.HOLD, "manual review")).isTrue();
        assertThat(order.getHoldReason()).isEqualTo("manual review");
        assertThat(order.transition(OrderStatus.REVIEW_PENDING, null)).isTrue();
        assertThat(order.transition(OrderStatus.READY_TO_FULFILL, null)).isTrue();
        assertThat(order.getStatus()).isEqualTo(OrderStatus.READY_TO_FULFILL);
    }

    @Test
    void supportsCancellationFromEveryApprovedNonReadyState() {
        TenantOrder received = order();
        received.transition(OrderStatus.CANCELLED, null);
        TenantOrder pending = order();
        pending.transition(OrderStatus.REVIEW_PENDING, null);
        pending.transition(OrderStatus.CANCELLED, null);
        TenantOrder held = order();
        held.transition(OrderStatus.HOLD, "review");
        held.transition(OrderStatus.CANCELLED, null);
        assertThat(received.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(pending.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(held.getStatus()).isEqualTo(OrderStatus.CANCELLED);
    }

    @Test
    void protectsTerminalAndInvalidTransitions() {
        TenantOrder order = order();
        assertThatThrownBy(() -> order.transition(OrderStatus.READY_TO_FULFILL, null))
                .isInstanceOf(IllegalStateException.class);
        order.transition(OrderStatus.CANCELLED, null);
        assertThatThrownBy(() -> order.transition(OrderStatus.REVIEW_PENDING, null))
                .isInstanceOf(IllegalStateException.class);
        assertThat(order.transition(OrderStatus.CANCELLED, null)).isFalse();
    }

    @Test
    void requiresReasonOnlyForHold() {
        assertThatThrownBy(() -> order().transition(OrderStatus.HOLD, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> order().transition(OrderStatus.REVIEW_PENDING, "unexpected"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static TenantOrder order() {
        return new TenantOrder(UUID.randomUUID(), UUID.randomUUID(), "external", "idem", "a".repeat(64),
                "USD", null, 1, Instant.parse("2026-07-28T00:00:00Z"));
    }
}
