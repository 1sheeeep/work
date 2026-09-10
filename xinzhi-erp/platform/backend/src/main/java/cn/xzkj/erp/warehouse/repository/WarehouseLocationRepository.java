package cn.xzkj.erp.warehouse.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.warehouse.domain.WarehouseLocation;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;

public interface WarehouseLocationRepository extends Repository<WarehouseLocation, UUID> {
    <S extends WarehouseLocation> S save(S entity);

    Optional<WarehouseLocation> findByIdAndTenantIdAndWarehouseId(
            UUID id, UUID tenantId, UUID warehouseId);

    boolean existsByTenantIdAndWarehouseIdAndBusinessCode(
            UUID tenantId, UUID warehouseId, String businessCode);

    boolean existsByTenantIdAndWarehouseIdAndStatusNot(
            UUID tenantId, UUID warehouseId, WarehouseStatus excludedStatus);

    @Query("""
            select l from WarehouseLocation l
            where l.tenantId = :tenantId and l.warehouseId = :warehouseId
            and ((:status is not null and l.status = :status)
                 or (:status is null and l.status <> :archivedStatus))
            and (:keywordPresent = false
                 or locate(:keyword, lower(l.businessCode)) > 0
                 or locate(:keyword, lower(l.name)) > 0)
            order by l.businessCode asc, l.id asc
            """)
    Page<WarehouseLocation> searchByTenantIdAndWarehouseId(
            @Param("tenantId") UUID tenantId,
            @Param("warehouseId") UUID warehouseId,
            @Param("status") WarehouseStatus status,
            @Param("archivedStatus") WarehouseStatus archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable);
}
