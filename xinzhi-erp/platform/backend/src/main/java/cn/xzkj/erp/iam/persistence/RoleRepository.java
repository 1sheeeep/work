package cn.xzkj.erp.iam.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

public interface RoleRepository extends Repository<RoleEntity, UUID> {

    Optional<RoleEntity> findByTenant_IdAndCode(UUID tenantId, String code);

    Optional<RoleEntity> findByIdAndTenant_Id(UUID id, UUID tenantId);

    Page<RoleEntity> findAllByTenant_Id(UUID tenantId, Pageable pageable);

    List<RoleEntity> findAllByTenant_IdAndIdIn(
            UUID tenantId,
            Collection<UUID> ids);

    boolean existsByTenant_IdAndCode(UUID tenantId, String code);

    RoleEntity saveAndFlush(RoleEntity role);
}
