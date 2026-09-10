package cn.xzkj.erp.settings.notice;

import java.time.Instant;
import java.util.UUID;

public record InternalNoticeRecord(
        UUID id,
        String title,
        String content,
        boolean pinned,
        String status,
        Instant publishedAt,
        Instant archivedAt,
        String createdByDisplayName,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}
