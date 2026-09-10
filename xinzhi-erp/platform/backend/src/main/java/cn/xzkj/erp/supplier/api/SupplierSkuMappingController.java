package cn.xzkj.erp.supplier.api;

import java.net.URI;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
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
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.CreateMappingRequest;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.MappingResponse;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.UpdateMappingRequest;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.service.SupplierActor;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/suppliers/{supplierId}/sku-mappings")
public class SupplierSkuMappingController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final SupplierSkuMappingService service;

    public SupplierSkuMappingController(SupplierSkuMappingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('suppliers.read')")
    public PageEnvelope<MappingResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID supplierId,
            @RequestParam(required = false) SupplierSkuMappingStatus status,
            @RequestParam(required = false) @Size(max = 120) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
                    @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(
                service.list(principal.tenantId(), supplierId, status, query,
                        pageable(page, size)),
                MappingResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('suppliers.write')")
    public ResponseEntity<MappingResponse> create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID supplierId,
            @Valid @RequestBody CreateMappingRequest request,
            HttpServletRequest httpRequest) {
        MappingResponse response = MappingResponse.from(service.create(
                actor(principal, httpRequest), supplierId, request));
        return ResponseEntity.created(URI.create(
                "/api/v1/suppliers/" + supplierId
                        + "/sku-mappings/" + response.id())).body(response);
    }

    @PutMapping("/{mappingId}")
    @PreAuthorize("hasAuthority('suppliers.write')")
    public MappingResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID supplierId,
            @PathVariable UUID mappingId,
            @Valid @RequestBody UpdateMappingRequest request,
            HttpServletRequest httpRequest) {
        return MappingResponse.from(service.update(
                actor(principal, httpRequest), supplierId, mappingId, request));
    }

    private static SupplierActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        return new SupplierActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId(request),
                request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null) {
            return null;
        }
        value = value.strip();
        return REQUEST_ID.matcher(value).matches() ? value : null;
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
