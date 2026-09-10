package cn.xzkj.erp.order.domain;

import java.time.Instant;
import java.util.UUID;

public record SkuMatchQueueItem(
        UUID orderId,
        long orderVersion,
        OrderStatus orderStatus,
        UUID shopId,
        String externalOrderRef,
        Instant placedAt,
        UUID lineId,
        String externalLineRef,
        String titleSnapshot,
        String externalListingRef,
        String externalVariantRef,
        UUID skuId,
        SkuMatchSource skuMatchSource
) { }
