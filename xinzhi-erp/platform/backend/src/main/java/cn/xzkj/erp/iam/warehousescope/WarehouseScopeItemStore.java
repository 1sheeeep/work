package cn.xzkj.erp.iam.warehousescope;

import jakarta.persistence.EntityManager;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Repository;

@Repository
public class WarehouseScopeItemStore {

    private final EntityManager entityManager;

    public WarehouseScopeItemStore(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Set<UUID> findWarehouseIds(UUID tenantId, UUID userId) {
        @SuppressWarnings("unchecked")
        List<UUID> results = entityManager.createNativeQuery("""
                        SELECT warehouse_id
                        FROM tenant_user_warehouse_scope_items
                        WHERE tenant_id = :tenantId AND user_id = :userId
                        ORDER BY warehouse_id
                        """, UUID.class)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .getResultList();
        return new LinkedHashSet<>(results);
    }

    public Map<UUID, String> lockWarehouses(
            UUID tenantId, Set<UUID> warehouseIds) {
        if (warehouseIds.isEmpty()) {
            return Map.of();
        }
        @SuppressWarnings("unchecked")
        List<Object[]> results = entityManager.createNativeQuery("""
                        SELECT id, status
                        FROM tenant_warehouses
                        WHERE tenant_id = :tenantId
                          AND id IN (:warehouseIds)
                        ORDER BY id
                        FOR UPDATE
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("warehouseIds", warehouseIds)
                .getResultList();
        Map<UUID, String> locked = new LinkedHashMap<>();
        for (Object[] result : results) {
            locked.put((UUID) result[0], (String) result[1]);
        }
        return Map.copyOf(locked);
    }

    public void deleteWarehouseIds(UUID tenantId, UUID userId) {
        entityManager.createNativeQuery("""
                        DELETE FROM tenant_user_warehouse_scope_items
                        WHERE tenant_id = :tenantId AND user_id = :userId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    public void insertWarehouseIds(
            UUID tenantId, UUID userId, Set<UUID> warehouseIds) {
        for (UUID warehouseId : warehouseIds) {
            entityManager.createNativeQuery("""
                            INSERT INTO tenant_user_warehouse_scope_items (
                                tenant_id, user_id, warehouse_id
                            ) VALUES (:tenantId, :userId, :warehouseId)
                            """)
                    .setParameter("tenantId", tenantId)
                    .setParameter("userId", userId)
                    .setParameter("warehouseId", warehouseId)
                    .executeUpdate();
        }
    }
}
