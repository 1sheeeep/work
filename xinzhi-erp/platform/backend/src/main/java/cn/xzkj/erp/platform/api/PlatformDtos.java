package cn.xzkj.erp.platform.api;

import java.time.Instant;
import java.util.UUID;

import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.PlatformStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class PlatformDtos {

    private PlatformDtos() {
    }

    public record CreatePlatformRequest(
            @NotBlank
            @Pattern(regexp = "[A-Za-z][A-Za-z0-9_]{1,31}")
            String code,
            @NotBlank
            @Size(max = 160)
            String displayName,
            @Size(max = 500)
            String description
    ) {
    }

    public record PlatformResponse(
            UUID id,
            String code,
            String displayName,
            String description,
            PlatformStatus status,
            Instant createdAt,
            Instant updatedAt,
            long version
    ) {
        public static PlatformResponse from(PlatformCatalogEntry entity) {
            return new PlatformResponse(
                    entity.getId(),
                    entity.getCode(),
                    entity.getDisplayName(),
                    entity.getDescription(),
                    entity.getStatus(),
                    entity.getCreatedAt(),
                    entity.getUpdatedAt(),
                    entity.getVersion()
            );
        }
    }
}
