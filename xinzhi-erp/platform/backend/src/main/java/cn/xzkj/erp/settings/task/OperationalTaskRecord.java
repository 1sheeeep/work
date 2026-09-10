package cn.xzkj.erp.settings.task;

import java.time.Instant;
import java.util.UUID;

public record OperationalTaskRecord(
        UUID id,
        String taskNo,
        String title,
        String category,
        String taskObject,
        String urgency,
        String assigneeName,
        String description,
        String status,
        Instant completedAt,
        String createdByDisplayName,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}
