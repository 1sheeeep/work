package cn.xzkj.erp.logistics.matchingrule;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
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
@RequestMapping("/api/v1/logistics/matching-rules")
public class MatchingRuleController {
    private final MatchingRuleService service;

    public MatchingRuleController(MatchingRuleService service) { this.service = service; }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<RuleResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100) String platform,
            @RequestParam(required = false) @Size(max = 160) String shop,
            @RequestParam(required = false) @Size(max = 160) String channel,
            @RequestParam(required = false) @Size(max = 160) String warehouse,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean autoHandover,
            @RequestParam(required = false) @Min(1) @Max(9999) Integer priority,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate updatedFrom,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate updatedTo,
            @RequestParam(required = false) @Size(max = 100) String name,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        Instant from = updatedFrom == null ? null : updatedFrom.atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant to = updatedTo == null ? null : updatedTo.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        return PageEnvelope.from(service.list(actor(principal, request),
                new MatchingRuleService.Filters(platform, shop, channel, warehouse,
                        status, autoHandover, priority, from, to, name),
                PageRequest.of(page, size)), RuleResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.matching_rule.write')")
    public RuleResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RuleWriteRequest body, HttpServletRequest request) {
        return RuleResponse.from(service.create(actor(principal, request), body.input()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.matching_rule.write')")
    public RuleResponse archive(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return RuleResponse.from(service.archive(actor(principal, request), id, body.version()));
    }

    private static MatchingRuleService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new MatchingRuleService.Actor(principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record RuleWriteRequest(@NotBlank @Size(max = 100) String name,
            @Min(1) @Max(9999) int priority,
            @Size(max = 100) String platform, @Size(max = 160) String shop,
            @NotBlank @Size(max = 160) String channel,
            @Size(max = 160) String warehouse, boolean autoHandover,
            LocalTime noHandoverStart, LocalTime noHandoverEnd,
            @Size(max = 500) String note) {
        MatchingRuleService.RuleInput input() {
            return new MatchingRuleService.RuleInput(name, priority, platform, shop,
                    channel, warehouse, autoHandover, noHandoverStart,
                    noHandoverEnd, note);
        }
    }

    public record ArchiveRequest(@Min(0) long version) { }

    public record RuleResponse(UUID id, String name, int priority,
            String platform, String shop, String channel, String warehouse,
            boolean autoHandover, LocalTime noHandoverStart,
            LocalTime noHandoverEnd, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static RuleResponse from(MatchingRuleRecord value) {
            return new RuleResponse(value.id(), value.name(), value.priority(),
                    value.platformName(), value.shopName(), value.channelName(),
                    value.warehouseName(), value.autoHandover(),
                    value.noHandoverStart(), value.noHandoverEnd(), value.note(),
                    value.status(), value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }
}
