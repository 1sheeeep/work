package cn.xzkj.erp.product.repository;

import java.sql.PreparedStatement;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;

@Repository
public class ProductSpuSensitiveAttributeRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public ProductSpuSensitiveAttributeRepository(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<UUID, List<ProductSensitiveAttributeCode>>
            findByTenantIdAndSpuIdIn(
                    UUID tenantId,
                    Collection<UUID> spuIds) {
        if (spuIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<ProductSensitiveAttributeCode>> result =
                new LinkedHashMap<>();
        jdbc.query("""
                SELECT spu_id, attribute_code
                FROM tenant_product_spu_sensitive_attributes
                WHERE tenant_id = :tenantId
                  AND spu_id IN (:spuIds)
                ORDER BY spu_id, sort_order
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("spuIds", spuIds),
                resultSet -> {
                    UUID spuId = resultSet.getObject("spu_id", UUID.class);
                    ProductSensitiveAttributeCode code =
                            ProductSensitiveAttributeCode.valueOf(
                                    resultSet.getString("attribute_code"));
                    result.computeIfAbsent(
                            spuId,
                            ignored -> new java.util.ArrayList<>())
                            .add(code);
                });
        return result;
    }

    public List<ProductSensitiveAttributeCode> findByTenantIdAndSpuId(
            UUID tenantId,
            UUID spuId) {
        return findByTenantIdAndSpuIdIn(tenantId, List.of(spuId))
                .getOrDefault(spuId, List.of());
    }

    public void replaceByTenantIdAndSpuId(
            UUID tenantId,
            UUID spuId,
            Collection<ProductSensitiveAttributeCode> values) {
        jdbc.update("""
                DELETE FROM tenant_product_spu_sensitive_attributes
                WHERE tenant_id = :tenantId AND spu_id = :spuId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("spuId", spuId));
        List<ProductSensitiveAttributeCode> stable =
                ProductSensitiveAttributeCode.stableDistinct(values);
        if (stable.isEmpty()) {
            return;
        }
        jdbc.getJdbcTemplate().batchUpdate("""
                INSERT INTO tenant_product_spu_sensitive_attributes (
                    tenant_id, spu_id, attribute_code, sort_order
                ) VALUES (?, ?, ?, ?)
                """,
                stable,
                stable.size(),
                (PreparedStatement statement,
                        ProductSensitiveAttributeCode code) -> {
                    statement.setObject(1, tenantId);
                    statement.setObject(2, spuId);
                    statement.setString(3, code.name());
                    statement.setInt(4, code.sortOrder());
                });
    }
}
