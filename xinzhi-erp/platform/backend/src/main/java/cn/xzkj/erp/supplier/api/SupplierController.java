package cn.xzkj.erp.supplier.api;

import java.net.URI;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.ResponseEntity;
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
import cn.xzkj.erp.supplier.api.SupplierDtos.SupplierResponse;
import cn.xzkj.erp.supplier.api.SupplierDtos.CreateSupplierRequest;
import cn.xzkj.erp.supplier.api.SupplierDtos.ImportSuppliersRequest;
import cn.xzkj.erp.supplier.api.SupplierDtos.ImportSuppliersResponse;
import cn.xzkj.erp.supplier.api.SupplierDtos.CreateSupplierWithMappingRequest;
import cn.xzkj.erp.supplier.api.SupplierDtos.SupplierWithMappingResponse;
import cn.xzkj.erp.supplier.api.SupplierDtos.UpdateSupplierRequest;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.service.SupplierActor;
import cn.xzkj.erp.supplier.service.SupplierMasterDataService;
import cn.xzkj.erp.supplier.service.SupplierOnboardingService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/suppliers")
public class SupplierController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final SupplierMasterDataService service;
    private final SupplierOnboardingService onboardingService;

    public SupplierController(
            SupplierMasterDataService service,
            SupplierOnboardingService onboardingService) {
        this.service = service;
        this.onboardingService = onboardingService;
    }

    @PostMapping("/with-sku-mapping")
    @PreAuthorize("hasAuthority('suppliers.write')")
    public ResponseEntity<SupplierWithMappingResponse> createWithMapping(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateSupplierWithMappingRequest request,
            HttpServletRequest httpRequest) {
        var result = onboardingService.createWithMapping(
                actor(principal, httpRequest), request);
        SupplierWithMappingResponse response = new SupplierWithMappingResponse(
                SupplierResponse.from(result.supplier()),
                SupplierSkuMappingDtos.MappingResponse.from(result.mapping()));
        return ResponseEntity.created(URI.create(
                "/api/v1/suppliers/" + response.supplier().id()))
                .body(response);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('suppliers.write')")
    public ResponseEntity<SupplierResponse> create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateSupplierRequest request,
            HttpServletRequest httpRequest) {
        SupplierResponse response = SupplierResponse.from(service.create(
                actor(principal, httpRequest), request));
        return ResponseEntity
                .created(URI.create("/api/v1/suppliers/" + response.id()))
                .body(response);
    }

    @PostMapping("/import")
    @PreAuthorize("hasAuthority('suppliers.write')")
    public ImportSuppliersResponse importSuppliers(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ImportSuppliersRequest request,
            HttpServletRequest httpRequest) {
        var suppliers = service.importSuppliers(
                actor(principal, httpRequest), request.items());
        var items = suppliers.stream().map(SupplierResponse::from).toList();
        return new ImportSuppliersResponse(items.size(), items);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('suppliers.read')")
    public PageEnvelope<SupplierResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) SupplierStatus status,
            @RequestParam(required = false) @Size(max = 100) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE)
                    int size) {
        return PageEnvelope.from(
                service.list(
                        principal.tenantId(),
                        status,
                        query,
                        pageable(page, size)),
                SupplierResponse::from);
    }

    @GetMapping("/{supplierId}")
    @PreAuthorize("hasAuthority('suppliers.read')")
    public SupplierResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID supplierId) {
        return SupplierResponse.from(
                service.get(principal.tenantId(), supplierId));
    }

    @PutMapping("/{supplierId}")
    @PreAuthorize("hasAuthority('suppliers.write')")
    public SupplierResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID supplierId,
            @Valid @RequestBody UpdateSupplierRequest request,
            HttpServletRequest httpRequest) {
        return SupplierResponse.from(service.update(
                actor(principal, httpRequest), supplierId, request));
    }

    private static SupplierActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        return new SupplierActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId(request),
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
