package cn.xzkj.erp.product.bundle;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import cn.xzkj.erp.product.domain.ProductStatus;

public record ProductBundleRecord(
        UUID id,
        String businessCode,
        String name,
        String description,
        ProductStatus status,
        List<Component> components,
        long version,
        String createdByDisplayName,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {

    public ProductBundleRecord {
        components = List.copyOf(components);
    }

    public int componentCount() {
        return components.size();
    }

    public long totalUnits() {
        return components.stream().mapToLong(Component::quantity).sum();
    }

    public record Component(
            UUID skuId,
            String skuCode,
            String skuName,
            int quantity) {
    }
}
