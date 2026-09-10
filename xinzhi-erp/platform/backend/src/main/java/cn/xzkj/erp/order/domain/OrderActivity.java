package cn.xzkj.erp.order.domain;

import java.time.Instant;
import java.util.UUID;

public record OrderActivity(
        UUID id,
        String activityType,
        String safeSummary,
        Instant createdAt) {
}
