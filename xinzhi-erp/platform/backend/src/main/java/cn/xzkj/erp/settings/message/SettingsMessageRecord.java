package cn.xzkj.erp.settings.message;

import java.time.Instant;
import java.util.UUID;

public record SettingsMessageRecord(
        UUID id,
        String title,
        String content,
        String type,
        boolean pinned,
        String createdByDisplayName,
        Instant publishedAt,
        boolean read,
        Instant readAt) {
}
