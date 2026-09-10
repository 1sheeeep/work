package cn.xzkj.erp.settings.approval;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/settings/approval-rules")
public class ApprovalRuleController {
    private final ApprovalRuleService service;

    public ApprovalRuleController(ApprovalRuleService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageResponse list(@AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(required = false) ApprovalRuleService.DocumentType documentType,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageResponse.from(service.list(actor(principal, request),
                new ApprovalRuleService.RuleQuery(enabled, documentType, keyword,
                        page, size)));
    }

    @GetMapping("/approver-candidates")
    @PreAuthorize("hasAuthority('settings.read')")
    public List<ApproverCandidateResponse> candidates(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return service.candidates(actor(principal, request)).stream()
                .map(value -> new ApproverCandidateResponse(value.userId(),
                        value.displayName())).toList();
    }

    @PostMapping
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public RuleResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RuleRequest body, HttpServletRequest request) {
        return RuleResponse.from(service.create(actor(principal, request),
                body.draft()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public RuleResponse update(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody UpdateRuleRequest body,
            HttpServletRequest request) {
        return RuleResponse.from(service.update(actor(principal, request), id,
                body.expectedVersion(), body.draft()));
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public RuleResponse setEnabled(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody StatusRequest body,
            HttpServletRequest request) {
        return RuleResponse.from(service.setEnabled(actor(principal, request), id,
                body.expectedVersion(), body.enabled()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @RequestParam @Min(0) long expectedVersion,
            HttpServletRequest request) {
        service.delete(actor(principal, request), id, expectedVersion);
    }

    private static ApprovalRuleService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ApprovalRuleService.Actor(principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record RuleRequest(@Min(1) @Max(10) int priority,
            @NotBlank @Size(max = 120) String name,
            @NotNull ApprovalRuleService.DocumentType documentType,
            @Size(max = 500) String description,
            boolean enabled,
            @NotEmpty @Size(max = 5) List<@NotNull UUID> approverUserIds) {
        ApprovalRuleService.RuleDraft draft() {
            return new ApprovalRuleService.RuleDraft(priority, name, documentType,
                    description, enabled, approverUserIds);
        }
    }

    public record UpdateRuleRequest(@Min(0) long expectedVersion,
            @Min(1) @Max(10) int priority,
            @NotBlank @Size(max = 120) String name,
            @NotNull ApprovalRuleService.DocumentType documentType,
            @Size(max = 500) String description,
            boolean enabled,
            @NotEmpty @Size(max = 5) List<@NotNull UUID> approverUserIds) {
        ApprovalRuleService.RuleDraft draft() {
            return new ApprovalRuleService.RuleDraft(priority, name, documentType,
                    description, enabled, approverUserIds);
        }
    }

    public record StatusRequest(@Min(0) long expectedVersion, boolean enabled) {
    }

    public record ApproverCandidateResponse(UUID userId, String displayName) {
    }

    public record ApproverResponse(UUID userId, String displayName, int stepOrder) {
    }

    public record RuleResponse(UUID id, int priority, String name,
            ApprovalRuleService.DocumentType documentType, String description,
            boolean enabled, List<ApproverResponse> approvers, long version,
            String createdByDisplayName, String updatedByDisplayName,
            Instant createdAt, Instant updatedAt) {
        static RuleResponse from(ApprovalRuleRecord source) {
            return new RuleResponse(source.id(), source.priority(), source.name(),
                    source.documentType(), source.description(), source.enabled(),
                    source.approvers().stream().map(value -> new ApproverResponse(
                            value.userId(), value.displayName(), value.stepOrder()))
                            .toList(), source.version(), source.createdByDisplayName(),
                    source.updatedByDisplayName(), source.createdAt(),
                    source.updatedAt());
        }
    }

    public record PageResponse(List<RuleResponse> items, int page, int size,
            long totalElements, int totalPages) {
        static PageResponse from(ApprovalRuleService.RulePage source) {
            return new PageResponse(source.items().stream().map(RuleResponse::from)
                    .toList(), source.page(), source.size(), source.totalElements(),
                    source.totalPages());
        }
    }
}
