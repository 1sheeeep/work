package cn.xzkj.erp.analytics.listingsales;

import java.util.UUID;

public record ListingRealtimeSalesActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
