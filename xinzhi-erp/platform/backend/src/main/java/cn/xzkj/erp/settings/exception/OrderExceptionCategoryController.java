package cn.xzkj.erp.settings.exception;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/settings/order-exception-categories")
public class OrderExceptionCategoryController {
    private final OrderExceptionCategoryService service;

    public OrderExceptionCategoryController(OrderExceptionCategoryService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public Response get(@AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return Response.from(service.get(actor(principal, request)));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public Response save(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody SaveRequest body, HttpServletRequest request) {
        return Response.from(service.save(actor(principal, request),
                body.expectedRevision(), body.items().stream().map(ItemRequest::draft)
                        .toList()));
    }

    private static OrderExceptionCategoryService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new OrderExceptionCategoryService.Actor(principal.tenantId(),
                principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record SaveRequest(@Min(0) long expectedRevision,
            @NotNull @Size(max = 50) List<@Valid ItemRequest> items) {
    }

    public record ItemRequest(UUID id,
            @NotBlank @Size(max = 80) String name,
            @Size(max = 240) String handlingGuidance,
            boolean enabled) {
        OrderExceptionCategoryService.CategoryDraft draft() {
            return new OrderExceptionCategoryService.CategoryDraft(id, name,
                    handlingGuidance, enabled);
        }
    }

    public record ItemResponse(UUID id, String name, String handlingGuidance,
            boolean enabled, int sortOrder, Instant createdAt, Instant updatedAt) {
        static ItemResponse from(OrderExceptionCategoryRecord.Category source) {
            return new ItemResponse(source.id(), source.name(),
                    source.handlingGuidance(), source.enabled(), source.sortOrder(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record Response(boolean configured, long revision,
            String updatedByDisplayName, Instant createdAt, Instant updatedAt,
            List<ItemResponse> items) {
        static Response from(OrderExceptionCategoryRecord source) {
            return new Response(source.configured(), source.revision(),
                    source.updatedByDisplayName(), source.createdAt(),
                    source.updatedAt(), source.items().stream()
                            .map(ItemResponse::from).toList());
        }
    }
}
