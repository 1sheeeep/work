package cn.xzkj.erp.logistics.forecast;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/forecast-batches")
public class LogisticsForecastBatchController {
    private final LogisticsForecastBatchService service;

    public LogisticsForecastBatchController(LogisticsForecastBatchService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<BatchResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "HISTORY") @Size(max = 16) String status,
            @RequestParam(required = false) @Size(max = 80) String batchType,
            @RequestParam(required = false) @Size(max = 160) String creator,
            @RequestParam(required = false) Boolean printed,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) @Size(max = 120) String forwarder,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request),
                new LogisticsForecastBatchService.Filters(status, batchType,
                        creator, printed, keyword, forwarder),
                PageRequest.of(page, pageSize)), BatchResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.forecast.write')")
    public BatchResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchCreateRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.create(actor(principal, request),
                body.input()));
    }

    @PostMapping("/{id}/status")
    @PreAuthorize("hasAuthority('logistics.forecast.write')")
    public BatchResponse updateStatus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody StatusRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.updateStatus(actor(principal, request),
                id, body.version(), body.status(), body.resultMessage()));
    }

    @PostMapping("/{id}/printed")
    @PreAuthorize("hasAuthority('logistics.forecast.write')")
    public BatchResponse markPrinted(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.markPrinted(actor(principal, request),
                id, body.version()));
    }

    private static LogisticsForecastBatchService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsForecastBatchService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record BatchCreateRequest(
            @NotBlank @Size(max = 80) String batchType,
            @NotBlank @Size(max = 120) String forwarder,
            @NotEmpty @Size(max = 200) List<@NotBlank @Size(max = 80) String> orderReferences,
            @DecimalMin(value = "0.001")
            @DecimalMax(value = "999999999.999")
            @NotNull @Digits(integer = 9, fraction = 3) BigDecimal totalWeightKg) {
        LogisticsForecastBatchService.BatchInput input() {
            return new LogisticsForecastBatchService.BatchInput(
                    batchType, forwarder, orderReferences, totalWeightKg);
        }
    }

    public record StatusRequest(@Min(0) long version,
            @NotBlank @Size(max = 16) String status,
            @Size(max = 500) String resultMessage) {
    }

    public record VersionRequest(@Min(0) long version) {
    }

    public record BatchResponse(UUID id, String batchNo, String batchType,
            String forwarder, List<String> orderReferences, int orderCount,
            BigDecimal totalWeightKg, String status, boolean printed,
            String resultMessage, String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static BatchResponse from(LogisticsForecastBatchRecord value) {
            return new BatchResponse(value.id(), value.batchNo(), value.batchType(),
                    value.forwarder(), value.orderReferences(), value.orderCount(),
                    value.totalWeightKg(), value.status(), value.printed(),
                    value.resultMessage(), value.createdByDisplayName(),
                    value.version(), value.createdAt(), value.updatedAt());
        }
    }
}
