package cn.xzkj.erp.product.domain;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;

public enum ProductSensitiveAttributeCode {
    BATTERY(0),
    INFRINGEMENT(1),
    MAGNETIC(2),
    COSMETIC_NON_LIQUID(3),
    COSMETIC_LIQUID(4),
    LIQUID_NON_COSMETIC(5),
    POWDER(6),
    PASTE(7),
    BLADED_ITEM(8),
    FLAMMABLE(9);

    private final int sortOrder;

    ProductSensitiveAttributeCode(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public int sortOrder() {
        return sortOrder;
    }

    public static List<ProductSensitiveAttributeCode> stableDistinct(
            Collection<ProductSensitiveAttributeCode> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        return values.stream()
                .distinct()
                .sorted(Comparator.comparingInt(ProductSensitiveAttributeCode::sortOrder))
                .toList();
    }
}
