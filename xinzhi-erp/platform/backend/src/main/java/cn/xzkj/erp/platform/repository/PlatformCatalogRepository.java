package cn.xzkj.erp.platform.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.PlatformStatus;
import jakarta.persistence.LockModeType;

public interface PlatformCatalogRepository extends Repository<PlatformCatalogEntry, UUID> {

    <S extends PlatformCatalogEntry> S save(S entity);

    Optional<PlatformCatalogEntry> findById(UUID id);

    Optional<PlatformCatalogEntry> findByCode(String code);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select platform from PlatformCatalogEntry platform where platform.id = :id")
    Optional<PlatformCatalogEntry> findForUpdateById(@Param("id") UUID id);

    Page<PlatformCatalogEntry> findAllByOrderByCode(Pageable pageable);

    Page<PlatformCatalogEntry> findAllByStatusNotOrderByCode(
            PlatformStatus excludedStatus,
            Pageable pageable
    );

    boolean existsByCode(String code);
}
