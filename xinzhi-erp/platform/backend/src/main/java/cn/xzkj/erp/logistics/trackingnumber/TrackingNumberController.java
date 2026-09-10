package cn.xzkj.erp.logistics.trackingnumber;

import java.time.Instant;
import java.util.List;
import java.util.Set;
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

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/tracking-numbers")
public class TrackingNumberController {
    private final TrackingNumberService service;

    public TrackingNumberController(TrackingNumberService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<Response> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(required = false) @Size(max = 100) String channel,
            @RequestParam(defaultValue = "TRACKING_NO") String searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        if (page < 0 || size < 1 || size > 200) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageEnvelope.from(service.list(actor(principal, request), type,
                status, channel, searchField, keyword, PageRequest.of(page, size)),
                Response::from);
    }

    @PostMapping("/imports")
    @PreAuthorize("hasAuthority('logistics.tracking_number.write')")
    public ImportResponse importNumbers(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ImportRequest body,
            HttpServletRequest request) {
        var result = service.importNumbers(actor(principal, request), body.type(),
                body.channel(), body.trackingReferences());
        return new ImportResponse(result.batchId(), result.importedCount());
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.tracking_number.write')")
    public Response archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return Response.from(service.archive(actor(principal, request), id, body.version()));
    }

    private static TrackingNumberService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new TrackingNumberService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                requestId, request.getRemoteAddr());
    }

    public record ImportRequest(
            @NotBlank String type,
            @NotBlank @Size(max = 100) String channel,
            @NotNull @Size(min = 1, max = 500) List<@NotBlank @Size(max = 160) String> trackingReferences) {}
    public record ArchiveRequest(@Min(0) long version) {}
    public record ImportResponse(UUID batchId, int importedCount) {}
    public record Response(
            UUID id, UUID importBatchId, String trackingType,
            String logisticsChannel, String trackingReference, String status,
            String orderReference, String packageNumber, Instant usedAt,
            long version, Instant createdAt) {
        static Response from(TrackingNumberRecord value) {
            return new Response(value.id(), value.importBatchId(), value.trackingType(),
                    value.logisticsChannel(), value.trackingReference(), value.status(),
                    value.orderReference(), value.packageNumber(), value.usedAt(),
                    value.version(), value.createdAt());
        }
    }
}
