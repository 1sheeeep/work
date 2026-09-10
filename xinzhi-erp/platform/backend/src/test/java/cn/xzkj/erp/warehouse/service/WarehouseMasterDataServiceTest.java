package cn.xzkj.erp.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.List;
import java.util.UUID;
import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.service.InventoryArchiveGuard;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseLocation;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseLocationRepository;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

@ExtendWith(MockitoExtension.class)
class WarehouseMasterDataServiceTest {
    @Mock private WarehouseRepository warehouseRepository;
    @Mock private WarehouseLocationRepository locationRepository;
    @Mock private SecurityAuditRecorder auditRecorder;
    @Mock private WarehouseScopeEvaluator scopeEvaluator;
    @Mock private InventoryArchiveGuard inventoryArchiveGuard;
    @Mock private WarehouseOperationArchiveGuard operationArchiveGuard;
    private WarehouseMasterDataService service;

    @BeforeEach
    void setUp() {
        service = new WarehouseMasterDataService(
                warehouseRepository,
                locationRepository,
                auditRecorder,
                scopeEvaluator,
                inventoryArchiveGuard,
                operationArchiveGuard);
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, java.util.Set.of()));
    }

    @Test
    void normalizesCodesAndRejectsDuplicatesWithinTheirOwnershipScope() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Warehouse warehouse = warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE);
        when(warehouseRepository.save(any())).thenAnswer(invocation -> {
            Warehouse saved = invocation.getArgument(0);
            if (saved.getId() == null) {
                ReflectionTestUtils.setField(saved, "id", UUID.randomUUID());
            }
            return saved;
        });
        when(warehouseRepository.findForUpdateByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse));
        when(locationRepository.save(any())).thenAnswer(invocation -> {
            WarehouseLocation saved = invocation.getArgument(0);
            if (saved.getId() == null) {
                ReflectionTestUtils.setField(saved, "id", UUID.randomUUID());
            }
            return saved;
        });

        service.createWarehouse(
                actor(tenantId), "  wh_north  ", "  North warehouse ");
        ArgumentCaptor<Warehouse> warehouseCaptor = ArgumentCaptor.forClass(Warehouse.class);
        verify(warehouseRepository).save(warehouseCaptor.capture());
        assertThat(warehouseCaptor.getValue().getBusinessCode()).isEqualTo("WH_NORTH");
        assertThat(warehouseCaptor.getValue().getName()).isEqualTo("North warehouse");

        service.createLocation(
                actor(tenantId), warehouseId, " a-01 ", " Picking A ");
        ArgumentCaptor<WarehouseLocation> locationCaptor =
                ArgumentCaptor.forClass(WarehouseLocation.class);
        verify(locationRepository).save(locationCaptor.capture());
        assertThat(locationCaptor.getValue().getBusinessCode()).isEqualTo("A-01");
        assertThat(locationCaptor.getValue().getName()).isEqualTo("Picking A");

        when(locationRepository.existsByTenantIdAndWarehouseIdAndBusinessCode(
                tenantId, warehouseId, "A-01")).thenReturn(true);
        assertThatThrownBy(() ->
                service.createLocation(
                        actor(tenantId), warehouseId, "a-01", "Duplicate"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void crossTenantAndWrongParentResourcesAreUniformlyNotFound() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        UUID locationId = UUID.randomUUID();
        when(warehouseRepository.findByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getWarehouse(
                        actor(tenantId), warehouseId))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.getLocation(
                        actor(tenantId), warehouseId, locationId))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(locationRepository, never())
                .findByIdAndTenantIdAndWarehouseId(any(), any(), any());
    }

    @Test
    void defaultListsExcludeArchivedAndTreatSearchCharactersLiterally() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(warehouseRepository.searchByTenantId(
                tenantId, null, WarehouseStatus.ARCHIVED, true, "north %_", pageable))
                .thenReturn(Page.empty(pageable));
        when(warehouseRepository.findByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE)));
        when(locationRepository.searchByTenantIdAndWarehouseId(
                tenantId, warehouseId, null, WarehouseStatus.ARCHIVED, true, "a %_", pageable))
                .thenReturn(Page.empty(pageable));

        service.listWarehouses(
                actor(tenantId), null, " North %_ ", pageable);
        service.listLocations(
                actor(tenantId), warehouseId, null, " A %_ ", pageable);

        verify(warehouseRepository).searchByTenantId(
                tenantId, null, WarehouseStatus.ARCHIVED, true, "north %_", pageable);
        verify(locationRepository).searchByTenantIdAndWarehouseId(
                tenantId, warehouseId, null, WarehouseStatus.ARCHIVED, true, "a %_", pageable);
    }

    @Test
    void exportsTheFilteredVisibleWarehousesAndEscapesFormulaCells() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(
                0, WarehouseMasterDataService.MAX_EXPORT_ROWS + 1);
        Warehouse warehouse = warehouse(
                tenantId, UUID.randomUUID(), WarehouseStatus.INACTIVE);
        ReflectionTestUtils.setField(warehouse, "name", " =SUM(A1)");
        ReflectionTestUtils.setField(
                warehouse, "createdAt", Instant.parse("2026-08-01T01:02:03Z"));
        ReflectionTestUtils.setField(
                warehouse, "updatedAt", Instant.parse("2026-08-01T04:05:06Z"));
        when(warehouseRepository.searchByTenantId(
                tenantId,
                WarehouseStatus.INACTIVE,
                WarehouseStatus.ARCHIVED,
                true,
                "north",
                pageable))
                .thenReturn(new PageImpl<>(List.of(warehouse), pageable, 1));

        var result = service.exportWarehouses(
                actor(tenantId), WarehouseStatus.INACTIVE, " North ");

        assertThat(result.filename()).isEqualTo("warehouses.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n")
                .contains("' =SUM(A1),WH_ONE,停用,")
                .contains("2026-08-01T01:02:03Z,2026-08-01T04:05:06Z\r\n");
    }

    @Test
    void rejectsWarehouseExportsAboveTheBoundedRowLimit() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(
                0, WarehouseMasterDataService.MAX_EXPORT_ROWS + 1);
        when(warehouseRepository.searchByTenantId(
                tenantId,
                null,
                WarehouseStatus.ARCHIVED,
                false,
                "",
                pageable))
                .thenReturn(new PageImpl<>(
                        List.of(), pageable,
                        WarehouseMasterDataService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() ->
                service.exportWarehouses(actor(tenantId), null, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void exportsOnlyTheHeaderWhenTheActorHasNoWarehouseScope() {
        UUID tenantId = UUID.randomUUID();
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, java.util.Set.of()));

        var result = service.exportWarehouses(actor(tenantId), null, null);

        assertThat(result.rowCount()).isZero();
        assertThat(result.content()).isEqualTo(
                "\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n");
        verify(warehouseRepository, never()).searchByTenantId(
                any(), any(), any(), anyBoolean(), any(), any());
        verify(warehouseRepository, never()).searchByTenantIdAndIdIn(
                any(), any(), any(), any(), anyBoolean(), any(), any());
    }

    @Test
    void exportsFilteredLocationsWithWarehouseContextAndEscapesFormulaCells() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(
                0, WarehouseMasterDataService.MAX_EXPORT_ROWS + 1);
        Warehouse warehouse = warehouse(
                tenantId, warehouseId, WarehouseStatus.ACTIVE);
        WarehouseLocation location = new WarehouseLocation(
                tenantId, warehouseId, "A-01", " =SUM(A1)");
        ReflectionTestUtils.setField(
                location, "createdAt", Instant.parse("2026-08-02T01:02:03Z"));
        ReflectionTestUtils.setField(
                location, "updatedAt", Instant.parse("2026-08-02T04:05:06Z"));
        location.update(" =SUM(A1)", WarehouseStatus.INACTIVE);
        when(warehouseRepository.findByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse));
        when(locationRepository.searchByTenantIdAndWarehouseId(
                tenantId,
                warehouseId,
                WarehouseStatus.INACTIVE,
                WarehouseStatus.ARCHIVED,
                true,
                "pick",
                pageable))
                .thenReturn(new PageImpl<>(List.of(location), pageable, 1));

        var result = service.exportLocations(
                actor(tenantId), warehouseId, WarehouseStatus.INACTIVE, " Pick ");

        assertThat(result.filename()).isEqualTo("warehouse-locations.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n")
                .contains("Warehouse,WH_ONE,' =SUM(A1),A-01,停用,")
                .contains("2026-08-02T01:02:03Z,2026-08-02T04:05:06Z\r\n");
    }

    @Test
    void rejectsLocationExportsAboveTheBoundedRowLimit() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(
                0, WarehouseMasterDataService.MAX_EXPORT_ROWS + 1);
        when(warehouseRepository.findByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(
                        warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE)));
        when(locationRepository.searchByTenantIdAndWarehouseId(
                tenantId,
                warehouseId,
                null,
                WarehouseStatus.ARCHIVED,
                false,
                "",
                pageable))
                .thenReturn(new PageImpl<>(
                        List.of(), pageable,
                        WarehouseMasterDataService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportLocations(
                actor(tenantId), warehouseId, null, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void enforcesOptimisticVersionAndChildFirstArchiveRules() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Warehouse warehouse = warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE);
        ReflectionTestUtils.setField(warehouse, "version", 3L);
        when(warehouseRepository.findForUpdateByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse));

        assertThatThrownBy(() ->
                service.updateWarehouse(
                        actor(tenantId), warehouseId, 2,
                        "Changed", WarehouseStatus.INACTIVE))
                .isInstanceOf(ConflictException.class);
        verify(warehouseRepository, never()).save(any());

        when(locationRepository.existsByTenantIdAndWarehouseIdAndStatusNot(
                tenantId, warehouseId, WarehouseStatus.ARCHIVED)).thenReturn(true);
        assertThatThrownBy(() -> service.archiveWarehouse(
                actor(tenantId), warehouseId, 3))
                .isInstanceOf(ConflictException.class);
        verify(warehouseRepository, never()).save(any());
    }

    @Test
    void checksInventoryAndOperationGuardsBeforeArchivingWarehouse() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Warehouse warehouse =
                warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE);
        when(warehouseRepository.findForUpdateByIdAndTenantId(
                warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse));
        when(locationRepository.existsByTenantIdAndWarehouseIdAndStatusNot(
                tenantId, warehouseId, WarehouseStatus.ARCHIVED))
                .thenReturn(false);
        when(warehouseRepository.save(warehouse)).thenReturn(warehouse);

        service.archiveWarehouse(actor(tenantId), warehouseId, 0);

        verify(inventoryArchiveGuard)
                .requireWarehouseHasZeroBalance(tenantId, warehouseId);
        verify(operationArchiveGuard)
                .requireNoOpenWarehouseDocuments(tenantId, warehouseId);
        verify(warehouseRepository).save(warehouse);
    }

    @Test
    void checksOperationGuardBeforeArchivingLocation() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        UUID locationId = UUID.randomUUID();
        Warehouse warehouse =
                warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE);
        WarehouseLocation location =
                new WarehouseLocation(tenantId, warehouseId, "A-01", "A");
        ReflectionTestUtils.setField(location, "id", locationId);
        when(warehouseRepository.findForUpdateByIdAndTenantId(
                warehouseId, tenantId))
                .thenReturn(Optional.of(warehouse));
        when(locationRepository.findByIdAndTenantIdAndWarehouseId(
                locationId, tenantId, warehouseId))
                .thenReturn(Optional.of(location));
        when(locationRepository.save(location)).thenReturn(location);

        service.archiveLocation(
                actor(tenantId), warehouseId, locationId, 0);

        verify(operationArchiveGuard)
                .requireNoOpenLocationDocuments(
                        tenantId, warehouseId, locationId);
        verify(locationRepository).save(location);
    }

    @Test
    void inactiveParentsRemainConfigurableButArchivedParentsAreImmutable() {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        UUID locationId = UUID.randomUUID();
        Warehouse inactive = warehouse(tenantId, warehouseId, WarehouseStatus.INACTIVE);
        WarehouseLocation location =
                new WarehouseLocation(tenantId, warehouseId, "A-01", "A");
        ReflectionTestUtils.setField(location, "id", locationId);
        when(warehouseRepository.findForUpdateByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(inactive));
        when(locationRepository.save(any())).thenAnswer(invocation -> {
            WarehouseLocation saved = invocation.getArgument(0);
            if (saved.getId() == null) {
                ReflectionTestUtils.setField(saved, "id", UUID.randomUUID());
            }
            return saved;
        });

        assertThat(service.createLocation(
                actor(tenantId), warehouseId, "A-02", "A2")
                .getBusinessCode()).isEqualTo("A-02");

        when(locationRepository.findByIdAndTenantIdAndWarehouseId(
                locationId, tenantId, warehouseId)).thenReturn(Optional.of(location));
        assertThat(service.updateLocation(
                actor(tenantId), warehouseId, locationId,
                0, "A", WarehouseStatus.ACTIVE))
                .isSameAs(location);

        Warehouse archived = warehouse(tenantId, warehouseId, WarehouseStatus.ACTIVE);
        archived.archive();
        when(warehouseRepository.findForUpdateByIdAndTenantId(warehouseId, tenantId))
                .thenReturn(Optional.of(archived));
        assertThatThrownBy(() ->
                service.createLocation(
                        actor(tenantId), warehouseId, "A-03", "A3"))
                .isInstanceOf(ConflictException.class);
    }

    private static Warehouse warehouse(
            UUID tenantId, UUID warehouseId, WarehouseStatus status) {
        Warehouse warehouse = new Warehouse(tenantId, "WH_ONE", "Warehouse");
        ReflectionTestUtils.setField(warehouse, "id", warehouseId);
        if (status != WarehouseStatus.ACTIVE) {
            warehouse.update("Warehouse", status);
        }
        return warehouse;
    }

    private static WarehouseActor actor(UUID tenantId) {
        return new WarehouseActor(
                tenantId, UUID.randomUUID(), null, null, "127.0.0.1");
    }
}
