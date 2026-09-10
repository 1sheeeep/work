package cn.xzkj.erp.platform.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;

public interface ShopSyncJobRepository extends Repository<ShopSyncJob, UUID> {

    <S extends ShopSyncJob> S save(S entity);

    Optional<ShopSyncJob> findByIdAndTenantIdAndShopId(UUID id, UUID tenantId, UUID shopId);

    Page<ShopSyncJob> findAllByTenantIdAndShopIdOrderByRequestedAtDesc(
            UUID tenantId,
            UUID shopId,
            Pageable pageable
    );

    boolean existsByTenantIdAndShopIdAndJobTypeAndStatusIn(
            UUID tenantId,
            UUID shopId,
            SyncJobType jobType,
            Collection<SyncJobStatus> statuses
    );

    List<ShopSyncJob> findAllByTenantIdAndShopIdAndStatusIn(
            UUID tenantId,
            UUID shopId,
            Collection<SyncJobStatus> statuses
    );
}
