package cn.xzkj.erp.warehouse.service;

import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.LOCATION_ARCHIVED;
import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.LOCATION_CREATED;
import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.LOCATION_UPDATED;
import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.WAREHOUSE_ARCHIVED;
import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.WAREHOUSE_CREATED;
import static cn.xzkj.erp.warehouse.domain.WarehouseAuditActions.WAREHOUSE_UPDATED;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.inventory.service.InventoryArchiveGuard;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseLocation;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseLocationRepository;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

@Service
public class WarehouseMasterDataService {

    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final List<String> WAREHOUSE_CSV_HEADER = List.of(
            "仓库名称", "业务编码", "状态", "创建时间", "更新时间");
    private static final List<String> LOCATION_CSV_HEADER = List.of(
            "仓库名称", "仓库编码", "库位名称", "库位编码", "状态", "创建时间", "更新时间");

    private final WarehouseRepository warehouseRepository;
    private final WarehouseLocationRepository locationRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final InventoryArchiveGuard inventoryArchiveGuard;
    private final WarehouseOperationArchiveGuard operationArchiveGuard;

    public WarehouseMasterDataService(
            WarehouseRepository warehouseRepository,
            WarehouseLocationRepository locationRepository,
            SecurityAuditRecorder auditRecorder,
            WarehouseScopeEvaluator scopeEvaluator,
            InventoryArchiveGuard inventoryArchiveGuard,
            WarehouseOperationArchiveGuard operationArchiveGuard) {
        this.warehouseRepository = warehouseRepository;
        this.locationRepository = locationRepository;
        this.auditRecorder = auditRecorder;
        this.scopeEvaluator = scopeEvaluator;
        this.inventoryArchiveGuard = inventoryArchiveGuard;
        this.operationArchiveGuard = operationArchiveGuard;
    }

    @Transactional
    public Warehouse createWarehouse(
            WarehouseActor actor, String businessCode, String name) {
        UUID tenantId = requireActor(actor);
        scopeEvaluator.requireAll(scope(actor));
        String code = normalizeCode(businessCode);
        if (warehouseRepository.existsByTenantIdAndBusinessCode(tenantId, code)) {
            throw new ConflictException("Warehouse business code already exists");
        }
        Warehouse saved = warehouseRepository.save(
                new Warehouse(tenantId, code, required(name)));
        audit(actor, WAREHOUSE_CREATED, "warehouse", saved.getId(),
                saved.getVersion(), Map.of("status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<Warehouse> listWarehouses(
            WarehouseActor actor,
            WarehouseStatus status,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        WarehouseScopeAccess access = scope(actor);
        String normalizedKeyword = normalizedKeyword(keyword);
        if (!access.allowsAll() && access.warehouseIds().isEmpty()) {
            return Page.empty(pageable);
        }
        if (!access.allowsAll()) {
            return warehouseRepository.searchByTenantIdAndIdIn(
                    tenantId,
                    access.warehouseIds(),
                    status,
                    WarehouseStatus.ARCHIVED,
                    normalizedKeyword != null,
                    normalizedKeyword == null ? "" : normalizedKeyword,
                    pageable);
        }
        return warehouseRepository.searchByTenantId(
                tenantId,
                status,
                WarehouseStatus.ARCHIVED,
                normalizedKeyword != null,
                normalizedKeyword == null ? "" : normalizedKeyword,
                pageable);
    }

    @Transactional(readOnly = true)
    public WarehouseExport exportWarehouses(
            WarehouseActor actor,
            WarehouseStatus status,
            String keyword) {
        Page<Warehouse> page = listWarehouses(
                actor,
                status,
                keyword,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Warehouse export exceeds the supported row limit");
        }
        return new WarehouseExport(
                "warehouses.csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                csv(page.getContent()));
    }

    @Transactional(readOnly = true)
    public Warehouse getWarehouse(
            WarehouseActor actor, UUID warehouseId) {
        UUID tenantId = requireActor(actor);
        return findVisibleWarehouse(scope(actor), tenantId, warehouseId);
    }

    @Transactional
    public Warehouse updateWarehouse(
            WarehouseActor actor,
            UUID warehouseId,
            long expectedVersion,
            String name,
            WarehouseStatus status) {
        UUID tenantId = requireActor(actor);
        Warehouse warehouse =
                findVisibleWarehouseForUpdate(
                        scope(actor), tenantId, warehouseId);
        requireVersion(warehouse.getVersion(), expectedVersion);
        requireMutableStatus(status, "warehouse");
        if (warehouse.getStatus() == WarehouseStatus.ARCHIVED) {
            throw new ConflictException("Archived warehouses cannot be changed");
        }
        warehouse.update(required(name), status);
        Warehouse saved = warehouseRepository.save(warehouse);
        audit(actor, WAREHOUSE_UPDATED, "warehouse", saved.getId(),
                expectedVersion + 1, Map.of("status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public Warehouse archiveWarehouse(
            WarehouseActor actor, UUID warehouseId, long expectedVersion) {
        UUID tenantId = requireActor(actor);
        Warehouse warehouse =
                findVisibleWarehouseForUpdate(
                        scope(actor), tenantId, warehouseId);
        requireVersion(warehouse.getVersion(), expectedVersion);
        if (warehouse.getStatus() == WarehouseStatus.ARCHIVED) {
            return warehouse;
        }
        if (locationRepository.existsByTenantIdAndWarehouseIdAndStatusNot(
                tenantId, warehouseId, WarehouseStatus.ARCHIVED)) {
            throw new ConflictException("Archive child locations before archiving the warehouse");
        }
        inventoryArchiveGuard.requireWarehouseHasZeroBalance(
                tenantId, warehouseId);
        operationArchiveGuard.requireNoOpenWarehouseDocuments(
                tenantId, warehouseId);
        warehouse.archive();
        Warehouse saved = warehouseRepository.save(warehouse);
        audit(actor, WAREHOUSE_ARCHIVED, "warehouse", saved.getId(),
                expectedVersion + 1, Map.of("status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public WarehouseLocation createLocation(
            WarehouseActor actor, UUID warehouseId,
            String businessCode, String name) {
        UUID tenantId = requireActor(actor);
        Warehouse warehouse =
                findVisibleWarehouseForUpdate(
                        scope(actor), tenantId, warehouseId);
        if (warehouse.getStatus() == WarehouseStatus.ARCHIVED) {
            throw new ConflictException("Locations cannot be created under archived warehouses");
        }
        String code = normalizeCode(businessCode);
        if (locationRepository.existsByTenantIdAndWarehouseIdAndBusinessCode(
                tenantId, warehouseId, code)) {
            throw new ConflictException("Location business code already exists in this warehouse");
        }
        WarehouseLocation saved = locationRepository.save(
                new WarehouseLocation(tenantId, warehouseId, code, required(name)));
        audit(actor, LOCATION_CREATED, "warehouse_location", saved.getId(),
                saved.getVersion(), Map.of(
                        "warehouseId", saved.getWarehouseId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<WarehouseLocation> listLocations(
            WarehouseActor actor,
            UUID warehouseId,
            WarehouseStatus status,
            String keyword,
            Pageable pageable) {
        UUID tenantId = requireActor(actor);
        findVisibleWarehouse(scope(actor), tenantId, warehouseId);
        String normalizedKeyword = normalizedKeyword(keyword);
        return locationRepository.searchByTenantIdAndWarehouseId(
                tenantId,
                warehouseId,
                status,
                WarehouseStatus.ARCHIVED,
                normalizedKeyword != null,
                normalizedKeyword == null ? "" : normalizedKeyword,
                pageable);
    }

    @Transactional(readOnly = true)
    public WarehouseLocationExport exportLocations(
            WarehouseActor actor,
            UUID warehouseId,
            WarehouseStatus status,
            String keyword) {
        Warehouse warehouse = getWarehouse(actor, warehouseId);
        Page<WarehouseLocation> page = listLocations(
                actor,
                warehouseId,
                status,
                keyword,
                PageRequest.of(0, MAX_EXPORT_ROWS + 1));
        if (page.getTotalElements() > MAX_EXPORT_ROWS
                || page.getNumberOfElements() > MAX_EXPORT_ROWS) {
            throw new ConflictException(
                    "Warehouse location export exceeds the supported row limit");
        }
        return new WarehouseLocationExport(
                "warehouse-locations.csv",
                CSV_MEDIA_TYPE,
                page.getNumberOfElements(),
                locationCsv(warehouse, page.getContent()));
    }

    @Transactional(readOnly = true)
    public WarehouseLocation getLocation(
            WarehouseActor actor, UUID warehouseId, UUID locationId) {
        UUID tenantId = requireActor(actor);
        findVisibleWarehouse(scope(actor), tenantId, warehouseId);
        return findLocation(tenantId, warehouseId, locationId);
    }

    @Transactional
    public WarehouseLocation updateLocation(
            WarehouseActor actor,
            UUID warehouseId,
            UUID locationId,
            long expectedVersion,
            String name,
            WarehouseStatus status) {
        UUID tenantId = requireActor(actor);
        findVisibleWarehouseForUpdate(
                scope(actor), tenantId, warehouseId);
        WarehouseLocation location = findLocation(tenantId, warehouseId, locationId);
        requireVersion(location.getVersion(), expectedVersion);
        requireMutableStatus(status, "location");
        if (location.getStatus() == WarehouseStatus.ARCHIVED) {
            throw new ConflictException("Archived locations cannot be changed");
        }
        location.update(required(name), status);
        WarehouseLocation saved = locationRepository.save(location);
        audit(actor, LOCATION_UPDATED, "warehouse_location", saved.getId(),
                expectedVersion + 1, Map.of(
                        "warehouseId", saved.getWarehouseId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public WarehouseLocation archiveLocation(
            WarehouseActor actor, UUID warehouseId,
            UUID locationId, long expectedVersion) {
        UUID tenantId = requireActor(actor);
        findVisibleWarehouseForUpdate(
                scope(actor), tenantId, warehouseId);
        WarehouseLocation location = findLocation(tenantId, warehouseId, locationId);
        requireVersion(location.getVersion(), expectedVersion);
        if (location.getStatus() == WarehouseStatus.ARCHIVED) {
            return location;
        }
        operationArchiveGuard.requireNoOpenLocationDocuments(
                tenantId, warehouseId, locationId);
        location.archive();
        WarehouseLocation saved = locationRepository.save(location);
        audit(actor, LOCATION_ARCHIVED, "warehouse_location", saved.getId(),
                expectedVersion + 1, Map.of(
                        "warehouseId", saved.getWarehouseId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    private void audit(
            WarehouseActor actor,
            String action,
            String resourceType,
            UUID resourceId,
            long version,
            Map<String, String> facts) {
        Map<String, String> details = new java.util.LinkedHashMap<>();
        details.put("version", Long.toString(version));
        details.putAll(facts);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private static UUID requireActor(WarehouseActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private Warehouse findWarehouse(UUID tenantId, UUID warehouseId) {
        requireTenant(tenantId);
        return warehouseRepository.findByIdAndTenantId(warehouseId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Warehouse was not found"));
    }

    private Warehouse findVisibleWarehouse(
            WarehouseScopeAccess access,
            UUID tenantId,
            UUID warehouseId) {
        scopeEvaluator.requireVisible(access, warehouseId);
        return findWarehouse(tenantId, warehouseId);
    }

    private Warehouse findWarehouseForUpdate(UUID tenantId, UUID warehouseId) {
        requireTenant(tenantId);
        return warehouseRepository.findForUpdateByIdAndTenantId(warehouseId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Warehouse was not found"));
    }

    private Warehouse findVisibleWarehouseForUpdate(
            WarehouseScopeAccess access,
            UUID tenantId,
            UUID warehouseId) {
        scopeEvaluator.requireVisible(access, warehouseId);
        return findWarehouseForUpdate(tenantId, warehouseId);
    }

    private WarehouseScopeAccess scope(WarehouseActor actor) {
        return scopeEvaluator.evaluate(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId());
    }

    private WarehouseLocation findLocation(
            UUID tenantId, UUID warehouseId, UUID locationId) {
        requireTenant(tenantId);
        return locationRepository.findByIdAndTenantIdAndWarehouseId(
                        locationId, tenantId, warehouseId)
                .orElseThrow(() -> new ResourceNotFoundException("Warehouse location was not found"));
    }

    private static void requireVersion(long current, long expected) {
        if (current != expected) {
            throw new ConflictException("The resource has changed");
        }
    }

    private static void requireMutableStatus(WarehouseStatus status, String resource) {
        if (status == WarehouseStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use archive for a " + resource);
        }
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    private static String normalizeCode(String value) {
        return required(value).toUpperCase(Locale.ROOT);
    }

    private static String normalizedKeyword(String value) {
        String normalized = nullable(value);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static String required(String value) {
        String normalized = nullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException("A required value is missing");
        }
        return normalized;
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String csv(List<Warehouse> warehouses) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, WAREHOUSE_CSV_HEADER);
        for (Warehouse warehouse : warehouses) {
            appendCsvRow(output, List.of(
                    warehouse.getName(),
                    warehouse.getBusinessCode(),
                    statusLabel(warehouse.getStatus()),
                    warehouse.getCreatedAt().toString(),
                    warehouse.getUpdatedAt().toString()));
        }
        return output.toString();
    }

    private static String locationCsv(
            Warehouse warehouse, List<WarehouseLocation> locations) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, LOCATION_CSV_HEADER);
        for (WarehouseLocation location : locations) {
            appendCsvRow(output, List.of(
                    warehouse.getName(),
                    warehouse.getBusinessCode(),
                    location.getName(),
                    location.getBusinessCode(),
                    statusLabel(location.getStatus()),
                    location.getCreatedAt().toString(),
                    location.getUpdatedAt().toString()));
        }
        return output.toString();
    }

    private static void appendCsvRow(StringBuilder output, List<String> cells) {
        for (int index = 0; index < cells.size(); index++) {
            if (index > 0) output.append(',');
            output.append(csvCell(cells.get(index)));
        }
        output.append("\r\n");
    }

    private static String csvCell(String value) {
        String safe = value == null ? "" : value;
        String stripped = safe.stripLeading();
        if (!stripped.isEmpty() && "=+-@".indexOf(stripped.charAt(0)) >= 0) {
            safe = "'" + safe;
        }
        if (safe.indexOf(',') >= 0 || safe.indexOf('"') >= 0
                || safe.indexOf('\r') >= 0 || safe.indexOf('\n') >= 0) {
            return '"' + safe.replace("\"", "\"\"") + '"';
        }
        return safe;
    }

    private static String statusLabel(WarehouseStatus status) {
        return switch (status) {
            case ACTIVE -> "启用";
            case INACTIVE -> "停用";
            case ARCHIVED -> "已归档";
        };
    }

    public record WarehouseExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }

    public record WarehouseLocationExport(
            String filename,
            String mediaType,
            int rowCount,
            String content) {
    }
}
