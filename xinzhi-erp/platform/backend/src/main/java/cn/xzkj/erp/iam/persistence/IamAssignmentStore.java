package cn.xzkj.erp.iam.persistence;

import jakarta.persistence.EntityManager;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Repository;

@Repository
public class IamAssignmentStore {

    private final EntityManager entityManager;

    public IamAssignmentStore(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Set<UUID> findRoleIds(UUID tenantId, UUID userId) {
        @SuppressWarnings("unchecked")
        List<UUID> results = entityManager.createNativeQuery("""
                        SELECT role_id
                        FROM user_roles
                        WHERE tenant_id = :tenantId AND user_id = :userId
                        ORDER BY role_id
                        """, UUID.class)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .getResultList();
        return new LinkedHashSet<>(results);
    }

    public boolean existsUserWithRole(UUID tenantId, UUID roleId) {
        Number count = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM user_roles
                        WHERE tenant_id = :tenantId AND role_id = :roleId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("roleId", roleId)
                .getSingleResult();
        return count.longValue() > 0;
    }

    public boolean existsUserWithSystemRole(UUID tenantId, UUID userId) {
        Number count = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM user_roles assignment
                        JOIN roles role
                          ON role.id = assignment.role_id
                         AND role.tenant_id = assignment.tenant_id
                        WHERE assignment.tenant_id = :tenantId
                          AND assignment.user_id = :userId
                          AND role.system_role = true
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .getSingleResult();
        return count.longValue() > 0;
    }

    public boolean existsUserWithSystemRoleCode(
            UUID tenantId,
            UUID userId,
            String roleCode) {
        Number count = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM user_roles assignment
                        JOIN roles role
                          ON role.id = assignment.role_id
                         AND role.tenant_id = assignment.tenant_id
                        WHERE assignment.tenant_id = :tenantId
                          AND assignment.user_id = :userId
                          AND role.system_role = true
                          AND role.code = :roleCode
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .setParameter("roleCode", roleCode)
                .getSingleResult();
        return count.longValue() > 0;
    }

    public long countUsersWithRole(UUID tenantId, UUID roleId) {
        Number count = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM user_roles
                        WHERE tenant_id = :tenantId AND role_id = :roleId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("roleId", roleId)
                .getSingleResult();
        return count.longValue();
    }

    public long countActiveUsersWithRole(UUID tenantId, UUID roleId) {
        Number count = (Number) entityManager.createNativeQuery("""
                        SELECT count(*)
                        FROM user_roles assignment
                        JOIN users account
                          ON account.id = assignment.user_id
                         AND account.tenant_id = assignment.tenant_id
                        WHERE assignment.tenant_id = :tenantId
                          AND assignment.role_id = :roleId
                          AND account.status = 'ACTIVE'
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("roleId", roleId)
                .getSingleResult();
        return count.longValue();
    }

    public void replaceUserRoles(UUID tenantId, UUID userId, Set<UUID> roleIds) {
        entityManager.createNativeQuery("""
                        DELETE FROM user_roles
                        WHERE tenant_id = :tenantId AND user_id = :userId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .executeUpdate();
        for (UUID roleId : roleIds) {
            entityManager.createNativeQuery("""
                            INSERT INTO user_roles (tenant_id, user_id, role_id)
                            VALUES (:tenantId, :userId, :roleId)
                            """)
                    .setParameter("tenantId", tenantId)
                    .setParameter("userId", userId)
                    .setParameter("roleId", roleId)
                    .executeUpdate();
        }
    }

    public Set<UUID> findPermissionIds(UUID tenantId, UUID roleId) {
        @SuppressWarnings("unchecked")
        List<UUID> results = entityManager.createNativeQuery("""
                        SELECT permission_id
                        FROM role_permissions
                        WHERE tenant_id = :tenantId AND role_id = :roleId
                        ORDER BY permission_id
                        """, UUID.class)
                .setParameter("tenantId", tenantId)
                .setParameter("roleId", roleId)
                .getResultList();
        return new LinkedHashSet<>(results);
    }

    public void replaceRolePermissions(
            UUID tenantId,
            UUID roleId,
            Set<UUID> permissionIds) {
        entityManager.createNativeQuery("""
                        DELETE FROM role_permissions
                        WHERE tenant_id = :tenantId AND role_id = :roleId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("roleId", roleId)
                .executeUpdate();
        for (UUID permissionId : permissionIds) {
            entityManager.createNativeQuery("""
                            INSERT INTO role_permissions (
                                tenant_id, role_id, permission_id
                            ) VALUES (:tenantId, :roleId, :permissionId)
                            """)
                    .setParameter("tenantId", tenantId)
                    .setParameter("roleId", roleId)
                    .setParameter("permissionId", permissionId)
                    .executeUpdate();
        }
    }
}
