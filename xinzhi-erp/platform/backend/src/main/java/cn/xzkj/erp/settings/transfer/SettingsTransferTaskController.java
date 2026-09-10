package cn.xzkj.erp.settings.transfer;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/settings/transfer-tasks")
public class SettingsTransferTaskController {
    private final SettingsTransferTaskService service;

    public SettingsTransferTaskController(SettingsTransferTaskService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageEnvelope<TaskResponse> list(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(defaultValue = "ALL") @Size(max = 16) String jobType,
            @RequestParam(defaultValue = "ALL") @Size(max = 32) String status,
            @RequestParam(required = false) @Size(max = 160) String keyword,
            @RequestParam(required = false) Boolean resultAvailable,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return PageEnvelope.from(service.list(tenantId,
                new SettingsTransferTaskService.Filters(
                        jobType, status, keyword, resultAvailable,
                        startDate, endDate),
                PageRequest.of(page, size)), TaskResponse::from);
    }

    @GetMapping("/{taskId}/result")
    @PreAuthorize("hasAuthority('settings.read')")
    public ResultResponse result(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID taskId) {
        SettingsTransferTaskService.Artifact artifact = service.result(
                principal.tenantId(), taskId);
        return new ResultResponse(artifact.filename(), artifact.mediaType(),
                Base64.getEncoder().encodeToString(artifact.content()));
    }

    public record TaskResponse(UUID id, String jobType, String status,
            String filename, String createdByDisplayName, int requestedCount,
            int succeededCount, int failedCount, String safeErrorSummary,
            boolean resultAvailable, long resultSizeBytes,
            Instant createdAt, Instant completedAt) {
        static TaskResponse from(SettingsTransferTaskRecord value) {
            return new TaskResponse(value.id(), value.jobType(), value.status(),
                    value.filename(), value.createdByDisplayName(),
                    value.requestedCount(), value.succeededCount(),
                    value.failedCount(), value.safeErrorSummary(),
                    value.resultAvailable(), value.resultSizeBytes(),
                    value.createdAt(),
                    value.completedAt());
        }
    }

    public record ResultResponse(
            String filename, String mediaType, String contentBase64) {
    }
}
