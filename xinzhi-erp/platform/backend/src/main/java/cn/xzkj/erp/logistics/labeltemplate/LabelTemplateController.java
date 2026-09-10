package cn.xzkj.erp.logistics.labeltemplate;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
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
@RequestMapping("/api/v1/logistics/label-templates")
public class LabelTemplateController {
    private final LabelTemplateService service;

    public LabelTemplateController(LabelTemplateService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<TemplateResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "STANDARD") String scope,
            @RequestParam(required = false) @Size(max = 80)
            String documentCategory,
            @RequestParam(required = false) @Size(max = 40) String size,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(
                        actor(principal, request), scope, documentCategory,
                        size, keyword, PageRequest.of(page, pageSize)),
                TemplateResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.label_template.write')")
    public TemplateResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody TemplateWriteRequest body,
            HttpServletRequest request) {
        return TemplateResponse.from(service.create(
                actor(principal, request), body.input()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.label_template.write')")
    public TemplateResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return TemplateResponse.from(service.archive(
                actor(principal, request), id, body.version()));
    }

    private static LabelTemplateService.Actor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LabelTemplateService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record TemplateWriteRequest(
            @NotBlank @Size(max = 120) String name,
            @NotBlank @Size(max = 80) String documentCategory,
            @Min(20) @Max(300) int widthMm,
            @Min(20) @Max(300) int heightMm,
            @NotBlank @Size(max = 4000) String content,
            @Size(max = 500) String note) {
        LabelTemplateService.TemplateInput input() {
            return new LabelTemplateService.TemplateInput(
                    name, documentCategory, widthMm, heightMm, content, note);
        }
    }

    public record ArchiveRequest(@Min(0) long version) {
    }

    public record TemplateResponse(
            UUID id,
            String scope,
            String name,
            String documentCategory,
            int widthMm,
            int heightMm,
            String content,
            String note,
            String status,
            String createdByDisplayName,
            long version,
            Instant createdAt,
            Instant updatedAt) {
        static TemplateResponse from(LabelTemplateRecord value) {
            return new TemplateResponse(
                    value.id(), value.scope(), value.name(),
                    value.documentCategory(), value.widthMm(), value.heightMm(),
                    value.content(), value.note(), value.status(),
                    value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }
}
