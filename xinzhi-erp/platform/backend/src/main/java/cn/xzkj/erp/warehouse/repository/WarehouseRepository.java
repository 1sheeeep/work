package cn.xzkj.erp.warehouse.repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;

public interface WarehouseRepository extends Repository<Warehouse, UUID> {
    <S extends Warehouse> S save(S entity);

    Optional<Warehouse> findByIdAndTenantId(UUID id, UUID tenantId);

    List<Warehouse> findAllByTenantIdAndStatusOrderByBusinessCodeAscIdAsc(
            UUID tenantId,
            WarehouseStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select w from Warehouse w
            where w.id = :id and w.tenantId = :tenantId
            """)
    Optional<Warehouse> findForUpdateByIdAndTenantId(
            @Param("id") UUID id, @Param("tenantId") UUID tenantId);

    boolean existsByTenantIdAndBusinessCode(UUID tenantId, String businessCode);

    @Query("""
            select w from Warehouse w
            where w.tenantId = :tenantId
            and ((:status is not null and w.status = :status)
                 or (:status is null and w.status <> :archivedStatus))
            and (:keywordPresent = false
                 or locate(:keyword, lower(w.businessCode)) > 0
                 or locate(:keyword, lower(w.name)) > 0)
            order by w.businessCode asc, w.id asc
            """)
    Page<Warehouse> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("status") WarehouseStatus status,
            @Param("archivedStatus") WarehouseStatus archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable);

    @Query("""
            select w from Warehouse w
            where w.tenantId = :tenantId
            and w.id in :warehouseIds
            and ((:status is not null and w.status = :status)
                 or (:status is null and w.status <> :archivedStatus))
            and (:keywordPresent = false
                 or locate(:keyword, lower(w.businessCode)) > 0
                 or locate(:keyword, lower(w.name)) > 0)
            order by w.businessCode asc, w.id asc
            """)
    Page<Warehouse> searchByTenantIdAndIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("warehouseIds") Set<UUID> warehouseIds,
            @Param("status") WarehouseStatus status,
            @Param("archivedStatus") WarehouseStatus archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable);
}
