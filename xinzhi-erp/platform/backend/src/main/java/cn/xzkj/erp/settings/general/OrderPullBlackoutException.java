package cn.xzkj.erp.settings.general;

import java.time.LocalTime;

import cn.xzkj.erp.platform.service.ConflictException;

public class OrderPullBlackoutException extends ConflictException {
    private final LocalTime resumesAt;

    public OrderPullBlackoutException(LocalTime resumesAt) {
        super("Shopify order pulling is disabled during the configured quiet period");
        this.resumesAt = resumesAt;
    }

    public LocalTime resumesAt() {
        return resumesAt;
    }
}
