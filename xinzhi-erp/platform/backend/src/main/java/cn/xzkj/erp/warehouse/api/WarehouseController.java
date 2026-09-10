package cn.xzkj.erp.warehouse.api;

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
import cn.xzkj.erp.warehouse.api.WarehouseDtos.ArchiveRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.CreateLocationRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.CreateWarehouseRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.LocationResponse;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.WarehouseLocationExportRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.WarehouseLocationExportResponse;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.UpdateLocationRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.UpdateWarehouseRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.WarehouseResponse;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.WarehouseExportRequest;
import cn.xzkj.erp.warehouse.api.WarehouseDtos.WarehouseExportResponse;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.service.WarehouseActor;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/warehouse-center/warehouses")
public class WarehouseController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final WarehouseMasterDataService service;

    public WarehouseController(WarehouseMasterDataService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('warehouses.write')")
    public ResponseEntity<WarehouseResponse> createWarehouse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateWarehouseRequest request,
            HttpServletRequest httpRequest) {
        WarehouseResponse response = WarehouseResponse.from(service.createWarehouse(
                actor(principal, httpRequest), request.businessCode(), request.name()));
        return ResponseEntity.created(URI.create(
                "/api/v1/warehouse-center/warehouses/" + response.id())).body(response);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('warehouses.read')")
    public PageEnvelope<WarehouseResponse> listWarehouses(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) WarehouseStatus status,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest httpRequest) {
        return PageEnvelope.from(
                service.listWarehouses(
                        actor(principal, httpRequest),
                        status,
                        keyword,
                        pageable(page, size)),
                WarehouseResponse::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public WarehouseExportResponse exportWarehouses(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody WarehouseExportRequest request,
            HttpServletRequest httpRequest) {
        var result = service.exportWarehouses(
                actor(principal, httpRequest),
                request.status(),
                request.keyword());
        return new WarehouseExportResponse(
                result.filename(),
                result.mediaType(),
                result.rowCount(),
                result.content());
    }

    @GetMapping("/{warehouseId}")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public WarehouseResponse getWarehouse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            HttpServletRequest httpRequest) {
        return WarehouseResponse.from(service.getWarehouse(
                actor(principal, httpRequest), warehouseId));
    }

    @PutMapping("/{warehouseId}")
    @PreAuthorize("hasAuthority('warehouses.write')")
    public WarehouseResponse updateWarehouse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody UpdateWarehouseRequest request,
            HttpServletRequest httpRequest) {
        return WarehouseResponse.from(service.updateWarehouse(
                actor(principal, httpRequest), warehouseId, request.version(),
                request.name(), request.status()));
    }

    @PostMapping("/{warehouseId}/archive")
    @PreAuthorize("hasAuthority('warehouses.write')")
    public WarehouseResponse archiveWarehouse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody ArchiveRequest request,
            HttpServletRequest httpRequest) {
        return WarehouseResponse.from(
                service.archiveWarehouse(actor(principal, httpRequest),
                        warehouseId, request.version()));
    }

    @PostMapping("/{warehouseId}/locations")
    @PreAuthorize("hasAuthority('warehouses.write')")
    public ResponseEntity<LocationResponse> createLocation(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody CreateLocationRequest request,
            HttpServletRequest httpRequest) {
        LocationResponse response = LocationResponse.from(service.createLocation(
                actor(principal, httpRequest), warehouseId,
                request.businessCode(), request.name()));
        return ResponseEntity.created(URI.create(
                "/api/v1/warehouse-center/warehouses/" + warehouseId
                        + "/locations/" + response.id())).body(response);
    }

    @GetMapping("/{warehouseId}/locations")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public PageEnvelope<LocationResponse> listLocations(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @RequestParam(required = false) WarehouseStatus status,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest httpRequest) {
        return PageEnvelope.from(
                service.listLocations(
                        actor(principal, httpRequest),
                        warehouseId,
                        status,
                        keyword,
                        pageable(page, size)),
                LocationResponse::from);
    }

    @PostMapping("/{warehouseId}/locations/exports")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public WarehouseLocationExportResponse exportLocations(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody WarehouseLocationExportRequest request,
            HttpServletRequest httpRequest) {
        var result = service.exportLocations(
                actor(principal, httpRequest),
                warehouseId,
                request.status(),
                request.keyword());
        return new WarehouseLocationExportResponse(
                result.filename(),
                result.mediaType(),
                result.rowCount(),
                result.content());
    }

    @GetMapping("/{warehouseId}/locations/{locationId}")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public LocationResponse getLocation(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @PathVariable UUID locationId,
            HttpServletRequest httpRequest) {
        return LocationResponse.from(service.getLocation(
                actor(principal, httpRequest),
                warehouseId,
                locationId));
    }

    @PutMapping("/{warehouseId}/locations/{locationId}")
    @PreAuthorize("hasAuthority('warehouses.write')")
    public LocationResponse updateLocation(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @PathVariable UUID locationId,
            @Valid @RequestBody UpdateLocationRequest request,
            HttpServletRequest httpRequest) {
        return LocationResponse.from(service.updateLocation(
                actor(principal, httpRequest),
                warehouseId,
                locationId,
                request.version(),
                request.name(),
                request.status()));
    }

    @PostMapping("/{warehouseId}/locations/{locationId}/archive")
    @PreAuthorize("hasAuthority('warehouses.write')")
    public LocationResponse archiveLocation(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @PathVariable UUID locationId,
            @Valid @RequestBody ArchiveRequest request,
            HttpServletRequest httpRequest) {
        return LocationResponse.from(service.archiveLocation(
                actor(principal, httpRequest), warehouseId,
                locationId, request.version()));
    }

    private static WarehouseActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        return new WarehouseActor(
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
