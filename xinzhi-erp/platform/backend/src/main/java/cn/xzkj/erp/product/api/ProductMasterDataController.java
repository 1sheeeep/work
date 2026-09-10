package cn.xzkj.erp.product.api;

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
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.AssignableMemberResponse;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.CategoryExportRequest;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.CategoryExportResponse;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.CategoryResponse;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.CreateCategoryRequest;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.CreatePackageMaterialRequest;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.PackageMaterialExportRequest;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.PackageMaterialExportResponse;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.PackageMaterialResponse;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.UpdateCategoryRequest;
import cn.xzkj.erp.product.api.ProductMasterDataDtos.UpdatePackageMaterialRequest;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.service.ProductActor;
import cn.xzkj.erp.product.service.ProductMasterDataService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/product-center/master-data")
public class ProductMasterDataController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final ProductMasterDataService service;
    private final IamAdministrationService iamAdministrationService;

    public ProductMasterDataController(
            ProductMasterDataService service,
            IamAdministrationService iamAdministrationService) {
        this.service = service;
        this.iamAdministrationService = iamAdministrationService;
    }

    @GetMapping("/assignable-members")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public PageEnvelope<AssignableMemberResponse> listAssignableMembers(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "100") @Min(1) @Max(100) int size) {
        var result = iamAdministrationService.listMembers(
                principal.tenantId(),
                null,
                AccountStatus.ACTIVE,
                null,
                page,
                size);
        return new PageEnvelope<>(
                result.items().stream()
                        .map(member -> new AssignableMemberResponse(
                                member.id(), member.displayName()))
                        .toList(),
                result.page(),
                result.size(),
                result.totalElements(),
                Math.toIntExact(result.totalPages()));
    }

    @GetMapping("/categories")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public PageEnvelope<CategoryResponse> listCategories(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false)
                    ProductMasterDataStatus status,
            @RequestParam(required = false) @Size(max = 100) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1)
                    @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(
                service.listCategories(
                        principal.tenantId(),
                        status,
                        query,
                        pageable(page, size)),
                CategoryResponse::from);
    }

    @PostMapping("/categories/exports")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public CategoryExportResponse exportCategories(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CategoryExportRequest request) {
        var export = service.exportCategoriesCsv(
                principal.tenantId(), request.status(), request.query());
        return new CategoryExportResponse(
                export.filename(),
                export.mediaType(),
                export.rowCount(),
                export.content());
    }

    @PostMapping("/categories")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public ResponseEntity<CategoryResponse> createCategory(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateCategoryRequest request,
            HttpServletRequest httpRequest) {
        CategoryResponse response = CategoryResponse.from(
                service.createCategory(
                        actor(principal, httpRequest),
                        request.name(),
                        request.sortOrder()));
        return ResponseEntity.created(URI.create(
                "/api/v1/product-center/master-data/categories/"
                + response.id())).body(response);
    }

    @GetMapping("/categories/{categoryId}")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public CategoryResponse getCategory(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID categoryId) {
        return CategoryResponse.from(service.getCategory(
                principal.tenantId(),
                categoryId));
    }

    @PutMapping("/categories/{categoryId}")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public CategoryResponse updateCategory(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID categoryId,
            @Valid @RequestBody UpdateCategoryRequest request,
            HttpServletRequest httpRequest) {
        return CategoryResponse.from(service.updateCategory(
                actor(principal, httpRequest),
                categoryId,
                request.version(),
                request.name(),
                request.sortOrder(),
                request.status()));
    }

    @DeleteMapping("/categories/{categoryId}")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public ResponseEntity<Void> deleteCategory(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID categoryId,
            @RequestParam @Min(0) long version,
            HttpServletRequest httpRequest) {
        service.deleteCategory(
                actor(principal, httpRequest),
                categoryId,
                version);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/package-materials")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public PageEnvelope<PackageMaterialResponse> listPackageMaterials(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false)
                    ProductMasterDataStatus status,
            @RequestParam(required = false) @Size(max = 100) String query,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1)
                    @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(
                service.listPackageMaterials(
                        principal.tenantId(),
                        status,
                        query,
                        pageable(page, size)),
                PackageMaterialResponse::from);
    }

    @PostMapping("/package-materials/exports")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public PackageMaterialExportResponse exportPackageMaterials(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody PackageMaterialExportRequest request) {
        var export = service.exportPackageMaterialsCsv(
                principal.tenantId(), request.status(), request.query());
        return new PackageMaterialExportResponse(
                export.filename(),
                export.mediaType(),
                export.rowCount(),
                export.content());
    }

    @PostMapping("/package-materials")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public ResponseEntity<PackageMaterialResponse> createPackageMaterial(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreatePackageMaterialRequest request,
            HttpServletRequest httpRequest) {
        PackageMaterialResponse response = PackageMaterialResponse.from(
                service.createPackageMaterial(
                        actor(principal, httpRequest),
                        request.values()));
        return ResponseEntity.created(URI.create(
                "/api/v1/product-center/master-data/package-materials/"
                + response.id())).body(response);
    }

    @GetMapping("/package-materials/{materialId}")
    @PreAuthorize("hasAuthority('products.master_data.read')")
    public PackageMaterialResponse getPackageMaterial(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID materialId) {
        return PackageMaterialResponse.from(service.getPackageMaterial(
                principal.tenantId(),
                materialId));
    }

    @PutMapping("/package-materials/{materialId}")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public PackageMaterialResponse updatePackageMaterial(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID materialId,
            @Valid @RequestBody UpdatePackageMaterialRequest request,
            HttpServletRequest httpRequest) {
        return PackageMaterialResponse.from(service.updatePackageMaterial(
                actor(principal, httpRequest),
                materialId,
                request.version(),
                request.values(),
                request.status()));
    }

    @DeleteMapping("/package-materials/{materialId}")
    @PreAuthorize("hasAuthority('products.master_data.write')")
    public ResponseEntity<Void> deletePackageMaterial(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID materialId,
            @RequestParam @Min(0) long version,
            HttpServletRequest httpRequest) {
        service.deletePackageMaterial(
                actor(principal, httpRequest),
                materialId,
                version);
        return ResponseEntity.noContent().build();
    }

    private static ProductActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        return new ProductActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
