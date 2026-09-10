package cn.xzkj.erp.settings.exception;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderExceptionCategoryRecord(
        boolean configured,
        long revision,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt,
        List<Category> items) {
    public OrderExceptionCategoryRecord {
        items = List.copyOf(items);
    }

    public record Category(UUID id, String name, String handlingGuidance,
            boolean enabled, int sortOrder, Instant createdAt, Instant updatedAt) {
    }
}
