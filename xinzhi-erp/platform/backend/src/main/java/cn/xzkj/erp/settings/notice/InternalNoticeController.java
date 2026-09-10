package cn.xzkj.erp.settings.notice;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
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
@RequestMapping("/api/v1/settings/internal-notices")
public class InternalNoticeController {
    private final InternalNoticeService service;

    public InternalNoticeController(InternalNoticeService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageEnvelope<NoticeResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 160) String title,
            @RequestParam(defaultValue = "ACTIVE") @Size(max = 16) String status,
            @RequestParam(required = false) Boolean pinned,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request),
                new InternalNoticeService.Filters(title, status, pinned),
                PageRequest.of(page, size)), NoticeResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('settings.notice.write')")
    public NoticeResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody NoticeWriteRequest body,
            HttpServletRequest request) {
        return NoticeResponse.from(service.create(actor(principal, request),
                new InternalNoticeService.NoticeInput(body.title(), body.content(),
                        body.pinned())));
    }

    @PostMapping("/{id}/pin")
    @PreAuthorize("hasAuthority('settings.notice.write')")
    public NoticeResponse setPinned(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody PinRequest body,
            HttpServletRequest request) {
        return NoticeResponse.from(service.setPinned(actor(principal, request),
                id, body.version(), body.pinned()));
    }

    @PostMapping("/{id}/status")
    @PreAuthorize("hasAuthority('settings.notice.write')")
    public NoticeResponse transition(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody StatusRequest body,
            HttpServletRequest request) {
        return NoticeResponse.from(service.transition(actor(principal, request),
                id, body.version(), body.status()));
    }

    @PostMapping("/batch-archive")
    @PreAuthorize("hasAuthority('settings.notice.write')")
    public List<NoticeResponse> archiveBatch(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchRequest body, HttpServletRequest request) {
        return service.archiveBatch(actor(principal, request), body.notices()
                        .stream().map(VersionItem::value).toList())
                .stream().map(NoticeResponse::from).toList();
    }

    private static InternalNoticeService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new InternalNoticeService.Actor(principal.tenantId(),
                principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record NoticeWriteRequest(
            @NotBlank @Size(max = 160) String title,
            @NotBlank @Size(max = 4000) String content,
            boolean pinned) {
    }

    public record PinRequest(@Min(0) long version, boolean pinned) {
    }

    public record StatusRequest(@Min(0) long version,
            @NotBlank @Size(max = 16) String status) {
    }

    public record VersionItem(@NotNull UUID id, @Min(0) long version) {
        InternalNoticeService.VersionedNotice value() {
            return new InternalNoticeService.VersionedNotice(id, version);
        }
    }

    public record BatchRequest(
            @NotEmpty @Size(max = 100) List<@Valid VersionItem> notices) {
    }

    public record NoticeResponse(UUID id, String title, String content,
            boolean pinned, String status, Instant publishedAt,
            Instant archivedAt, String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static NoticeResponse from(InternalNoticeRecord value) {
            return new NoticeResponse(value.id(), value.title(), value.content(),
                    value.pinned(), value.status(), value.publishedAt(),
                    value.archivedAt(), value.createdByDisplayName(),
                    value.version(), value.createdAt(), value.updatedAt());
        }
    }
}
