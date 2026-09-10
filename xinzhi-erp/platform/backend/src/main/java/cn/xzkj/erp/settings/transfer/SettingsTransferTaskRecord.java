package cn.xzkj.erp.settings.transfer;

import java.time.Instant;
import java.util.UUID;

public record SettingsTransferTaskRecord(
        UUID id,
        String jobType,
        String status,
        String filename,
        String createdByDisplayName,
        int requestedCount,
        int succeededCount,
        int failedCount,
        String safeErrorSummary,
        boolean resultAvailable,
        long resultSizeBytes,
        Instant createdAt,
        Instant completedAt) {
}
