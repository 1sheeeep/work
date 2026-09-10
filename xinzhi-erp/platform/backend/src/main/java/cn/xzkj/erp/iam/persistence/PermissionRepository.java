package cn.xzkj.erp.iam.persistence;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface PermissionRepository extends Repository<PermissionEntity, UUID> {

    Optional<PermissionEntity> findByCode(String code);

    Page<PermissionEntity> findAll(Pageable pageable);

    List<PermissionEntity> findAllByIdIn(Collection<UUID> ids);

    List<PermissionEntity> findAllByCodeIn(Collection<String> codes);

    List<PermissionEntity> findAllByOrderByCodeAsc();

    @Query("select permission.code from PermissionEntity permission order by permission.code")
    List<String> findAllCodes();

    @Query(value = """
            SELECT DISTINCT permission.code
            FROM permissions permission
            JOIN role_permissions role_permission
              ON role_permission.permission_id = permission.id
             AND role_permission.tenant_id = :tenantId
            JOIN user_roles user_role
              ON user_role.role_id = role_permission.role_id
             AND user_role.tenant_id = role_permission.tenant_id
            JOIN roles role
              ON role.id = user_role.role_id
             AND role.tenant_id = user_role.tenant_id
            WHERE user_role.tenant_id = :tenantId
              AND user_role.user_id = :userId
            ORDER BY permission.code
            """, nativeQuery = true)
    List<String> findCodesByTenantIdAndUserId(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId);
}
