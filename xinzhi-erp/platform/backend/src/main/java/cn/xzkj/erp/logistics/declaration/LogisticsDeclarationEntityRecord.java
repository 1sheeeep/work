package cn.xzkj.erp.logistics.declaration;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record LogisticsDeclarationEntityRecord(
        UUID id,
        String name,
        String enterpriseCode,
        List<ShopBinding> shops,
        String status,
        long version,
        Instant createdAt,
        Instant updatedAt) {

    public LogisticsDeclarationEntityRecord {
        shops = shops == null ? List.of() : List.copyOf(shops);
    }

    public record ShopBinding(
            UUID shopId,
            String shopName,
            String shopStatus,
            String platformCode,
            String platformName) {
    }
}
