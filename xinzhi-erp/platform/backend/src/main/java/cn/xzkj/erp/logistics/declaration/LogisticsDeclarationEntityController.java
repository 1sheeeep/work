package cn.xzkj.erp.logistics.declaration;

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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.declaration.LogisticsDeclarationEntityRecord.ShopBinding;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/declaration-entities")
public class LogisticsDeclarationEntityController {
    private final LogisticsDeclarationEntityService service;

    public LogisticsDeclarationEntityController(
            LogisticsDeclarationEntityService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<EntityResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "ACTIVE") String status,
            @RequestParam(defaultValue = "NAME") String searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        validatePage(page, size);
        return PageEnvelope.from(service.list(actor(principal, request), status,
                searchField, keyword, PageRequest.of(page, size)),
                EntityResponse::from);
    }

    @GetMapping("/shop-options")
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<ShopOptionResponse> shopOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "100") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        validatePage(page, size);
        return PageEnvelope.from(service.listShopOptions(actor(principal, request),
                keyword, PageRequest.of(page, size)), ShopOptionResponse::from);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.declaration_entity.write')")
    public EntityResponse detail(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, HttpServletRequest request) {
        return EntityResponse.from(service.detail(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.declaration_entity.write')")
    public EntityResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody WriteRequest body, HttpServletRequest request) {
        return EntityResponse.from(service.create(actor(principal, request),
                body.input()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.declaration_entity.write')")
    public EntityResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody UpdateRequest body,
            HttpServletRequest request) {
        return EntityResponse.from(service.update(actor(principal, request), id,
                body.version(), body.entity().input()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.declaration_entity.write')")
    public EntityResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return EntityResponse.from(service.archive(actor(principal, request), id,
                body.version()));
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 200) {
            throw new ConstraintViolationException(Set.of());
        }
    }

    private static LogisticsDeclarationEntityService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsDeclarationEntityService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                requestId, request.getRemoteAddr());
    }

    public record WriteRequest(
            @NotBlank @Size(max = 200) String name,
            @NotBlank @Size(max = 100)
            @Pattern(regexp = "(?i)^[a-z0-9][a-z0-9._:/ -]{0,99}$")
            String enterpriseCode,
            @NotNull @Size(max = 100) Set<@NotNull UUID> shopIds) {
        LogisticsDeclarationEntityService.EntityInput input() {
            return new LogisticsDeclarationEntityService.EntityInput(
                    name, enterpriseCode, shopIds);
        }
    }

    public record UpdateRequest(
            @Min(0) long version,
            @NotNull @Valid WriteRequest entity) {
    }

    public record ArchiveRequest(@Min(0) long version) {
    }

    public record ShopBindingResponse(
            UUID shopId, String shopName, String shopStatus,
            String platformCode, String platformName) {
        static ShopBindingResponse from(ShopBinding value) {
            return new ShopBindingResponse(value.shopId(), value.shopName(),
                    value.shopStatus(), value.platformCode(), value.platformName());
        }
    }

    public record EntityResponse(
            UUID id, String name, String enterpriseCode,
            List<ShopBindingResponse> shops, String status, long version,
            Instant createdAt, Instant updatedAt) {
        static EntityResponse from(LogisticsDeclarationEntityRecord value) {
            return new EntityResponse(value.id(), value.name(),
                    value.enterpriseCode(), value.shops().stream()
                            .map(ShopBindingResponse::from).toList(),
                    value.status(), value.version(), value.createdAt(),
                    value.updatedAt());
        }
    }

    public record ShopOptionResponse(
            UUID id, String name, String status,
            String platformCode, String platformName) {
        static ShopOptionResponse from(
                LogisticsDeclarationEntityRepository.ShopOption value) {
            return new ShopOptionResponse(value.id(), value.name(), value.status(),
                    value.platformCode(), value.platformName());
        }
    }
}
