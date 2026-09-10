package cn.xzkj.erp.analytics.listingsales;

import java.time.Instant;
import java.util.UUID;

public record ListingRealtimeSalesItem(
        UUID listingId,
        String platformCode,
        String platformName,
        UUID shopId,
        String shopName,
        String externalListingRef,
        String externalVariantRef,
        UUID skuId,
        String skuCode,
        String skuName,
        String variantSummary,
        long rangeSalesQuantity,
        long rangeOrderCount,
        long todaySalesQuantity,
        long yesterdaySalesQuantity,
        long last7DaysSalesQuantity,
        long last28DaysSalesQuantity,
        long last42DaysSalesQuantity,
        Instant lastPlacedAt) {
}
