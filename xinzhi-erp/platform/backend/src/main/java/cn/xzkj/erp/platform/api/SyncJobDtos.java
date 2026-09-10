package cn.xzkj.erp.platform.api;

import java.time.Instant;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class SyncJobDtos {

    private SyncJobDtos() {
    }

    public record CreateSyncJobRequest(
            @NotNull
            SyncJobType jobType
    ) {
    }

    public record UpdateSyncJobRequest(
            @NotNull
            SyncJobStatus status,
            @Min(0)
            int progressProcessed,
            @Min(0)
            Integer progressTotal,
            @Pattern(regexp = "[A-Z0-9_]{1,80}")
            String errorCode,
            @Size(max = 1000)
            String errorSummary
    ) {
    }

    public record SyncJobResponse(
            UUID id,
            UUID shopId,
            SyncJobType jobType,
            SyncJobStatus status,
            int progressProcessed,
            Integer progressTotal,
            int attemptCount,
            String errorCode,
            String errorSummary,
            Instant requestedAt,
            Instant startedAt,
            Instant completedAt,
            Instant updatedAt,
            long version
    ) {
        public static SyncJobResponse from(ShopSyncJob entity) {
            return new SyncJobResponse(
                    entity.getId(),
                    entity.getShopId(),
                    entity.getJobType(),
                    entity.getStatus(),
                    entity.getProgressProcessed(),
                    entity.getProgressTotal(),
                    entity.getAttemptCount(),
                    entity.getErrorCode(),
                    entity.getErrorSummary(),
                    entity.getRequestedAt(),
                    entity.getStartedAt(),
                    entity.getCompletedAt(),
                    entity.getUpdatedAt(),
                    entity.getVersion()
            );
        }
    }
}
