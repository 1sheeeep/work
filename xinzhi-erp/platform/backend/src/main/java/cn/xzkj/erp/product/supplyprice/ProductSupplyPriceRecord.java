package cn.xzkj.erp.product.supplyprice;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import cn.xzkj.erp.product.domain.ProductStatus;

public record ProductSupplyPriceRecord(
        UUID id,
        SkuType skuType,
        UUID referenceId,
        String skuCode,
        String skuName,
        String salesCountry,
        String currency,
        BigDecimal unitPrice,
        int minimumQuantity,
        LocalDate validFrom,
        LocalDate validTo,
        ProductStatus status,
        String note,
        long version,
        String createdByDisplayName,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {

    public enum SkuType {
        INVENTORY,
        BUNDLE
    }
}
