package cn.xzkj.erp.product.bundle;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.product.domain.ProductStatus;

@Repository
class ProductBundleRepository {
    private final NamedParameterJdbcTemplate jdbc;

    ProductBundleRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ProductBundleService.BundlePage list(
            UUID tenantId,
            ProductBundleService.BundleQuery query) {
        MapSqlParameterSource parameters = queryParameters(tenantId, query);
        Long total = jdbc.queryForObject("""
                select count(*)
                  from tenant_product_bundles bundle
                 where bundle.tenant_id = :tenantId
                   and ((cast(:status as varchar) is null
                         and bundle.status <> 'ARCHIVED')
                        or bundle.status = cast(:status as varchar))
                   and (cast(:keyword as varchar) is null
                        or lower(bundle.business_code) like :keyword
                        or lower(bundle.name) like :keyword
                        or lower(coalesce(bundle.description, '')) like :keyword)
                   and (cast(:fromInclusive as timestamptz) is null
                        or bundle.created_at >= :fromInclusive)
                   and (cast(:toExclusive as timestamptz) is null
                        or bundle.created_at < :toExclusive)
                """, parameters, Long.class);
        List<BundleRow> rows = jdbc.query("""
                select bundle.id, bundle.business_code, bundle.name,
                       bundle.description, bundle.status, bundle.version,
                       bundle.created_by_display_name,
                       bundle.updated_by_display_name,
                       bundle.created_at, bundle.updated_at
                  from tenant_product_bundles bundle
                 where bundle.tenant_id = :tenantId
                   and ((cast(:status as varchar) is null
                         and bundle.status <> 'ARCHIVED')
                        or bundle.status = cast(:status as varchar))
                   and (cast(:keyword as varchar) is null
                        or lower(bundle.business_code) like :keyword
                        or lower(bundle.name) like :keyword
                        or lower(coalesce(bundle.description, '')) like :keyword)
                   and (cast(:fromInclusive as timestamptz) is null
                        or bundle.created_at >= :fromInclusive)
                   and (cast(:toExclusive as timestamptz) is null
                        or bundle.created_at < :toExclusive)
                 order by bundle.created_at desc, bundle.business_code, bundle.id
                 limit :size offset :offset
                """, parameters, ProductBundleRepository::mapRow);
        Map<UUID, List<ProductBundleRecord.Component>> components =
                findComponents(tenantId, rows.stream().map(BundleRow::id).toList());
        List<ProductBundleRecord> items = rows.stream()
                .map(row -> row.record(components.getOrDefault(row.id(), List.of())))
                .toList();
        return new ProductBundleService.BundlePage(
                items, query.page(), query.size(), total == null ? 0 : total);
    }

    Optional<ProductBundleRecord> find(UUID tenantId, UUID id) {
        Optional<BundleRow> row = jdbc.query("""
                select bundle.id, bundle.business_code, bundle.name,
                       bundle.description, bundle.status, bundle.version,
                       bundle.created_by_display_name,
                       bundle.updated_by_display_name,
                       bundle.created_at, bundle.updated_at
                  from tenant_product_bundles bundle
                 where bundle.tenant_id = :tenantId and bundle.id = :id
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id), ProductBundleRepository::mapRow)
                .stream().findFirst();
        return row.map(value -> value.record(
                findComponents(tenantId, List.of(id)).getOrDefault(id, List.of())));
    }

    boolean existsByBusinessCode(UUID tenantId, String businessCodeKey) {
        Boolean exists = jdbc.queryForObject("""
                select exists (
                    select 1 from tenant_product_bundles
                     where tenant_id = :tenantId
                       and business_code_key = :businessCodeKey
                )
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("businessCodeKey", businessCodeKey), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    Set<UUID> availableSkuIds(UUID tenantId, Collection<UUID> ids) {
        if (ids.isEmpty()) return Set.of();
        return new LinkedHashSet<>(jdbc.queryForList("""
                select id from tenant_product_skus
                 where tenant_id = :tenantId
                   and id in (:ids)
                   and status <> 'ARCHIVED'
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("ids", ids), UUID.class));
    }

    void insert(
            UUID tenantId,
            UUID id,
            ProductBundleService.BundleInput input,
            ProductBundleService.Actor actor) {
        jdbc.update("""
                insert into tenant_product_bundles (
                    id, tenant_id, business_code, business_code_key,
                    name, description, status,
                    created_by_display_name, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :businessCode, :businessCodeKey,
                    :name, :description, :status,
                    :displayName, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, id, input, actor));
        replaceComponents(tenantId, id, input.components());
    }

    boolean update(
            UUID tenantId,
            UUID id,
            long version,
            ProductBundleService.BundleInput input,
            ProductBundleService.Actor actor) {
        int updated = jdbc.update("""
                update tenant_product_bundles
                   set name = :name,
                       description = :description,
                       status = :status,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId
                   and id = :id
                   and version = :version
                   and status <> 'ARCHIVED'
                """, parameters(tenantId, id, input, actor)
                .addValue("version", version));
        if (updated == 1) {
            replaceComponents(tenantId, id, input.components());
        }
        return updated == 1;
    }

    boolean archive(
            UUID tenantId,
            UUID id,
            long version,
            ProductBundleService.Actor actor) {
        return jdbc.update("""
                update tenant_product_bundles
                   set status = 'ARCHIVED',
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId
                   and id = :id
                   and version = :version
                   and status <> 'ARCHIVED'
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id)
                .addValue("version", version)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId())) == 1;
    }

    private void replaceComponents(
            UUID tenantId,
            UUID bundleId,
            List<ProductBundleService.ComponentInput> components) {
        jdbc.update("""
                delete from tenant_product_bundle_components
                 where tenant_id = :tenantId and bundle_id = :bundleId
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("bundleId", bundleId));
        for (ProductBundleService.ComponentInput component : components) {
            jdbc.update("""
                    insert into tenant_product_bundle_components (
                        tenant_id, bundle_id, sku_id, quantity
                    ) values (:tenantId, :bundleId, :skuId, :quantity)
                    """, new MapSqlParameterSource("tenantId", tenantId)
                    .addValue("bundleId", bundleId)
                    .addValue("skuId", component.skuId())
                    .addValue("quantity", component.quantity()));
        }
    }

    private Map<UUID, List<ProductBundleRecord.Component>> findComponents(
            UUID tenantId,
            List<UUID> bundleIds) {
        if (bundleIds.isEmpty()) return Map.of();
        Map<UUID, List<ProductBundleRecord.Component>> result = new LinkedHashMap<>();
        jdbc.query("""
                select component.bundle_id, component.sku_id,
                       sku.business_code, sku.name, component.quantity
                  from tenant_product_bundle_components component
                  join tenant_product_skus sku
                    on sku.tenant_id = component.tenant_id
                   and sku.id = component.sku_id
                 where component.tenant_id = :tenantId
                   and component.bundle_id in (:bundleIds)
                 order by component.bundle_id, lower(sku.business_code), sku.id
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("bundleIds", bundleIds), resultSet -> {
                    UUID bundleId = resultSet.getObject("bundle_id", UUID.class);
                    result.computeIfAbsent(bundleId, ignored -> new ArrayList<>())
                            .add(new ProductBundleRecord.Component(
                                    resultSet.getObject("sku_id", UUID.class),
                                    resultSet.getString("business_code"),
                                    resultSet.getString("name"),
                                    resultSet.getInt("quantity")));
                });
        return result;
    }

    private static MapSqlParameterSource queryParameters(
            UUID tenantId,
            ProductBundleService.BundleQuery query) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("status", query.status() == null
                        ? null : query.status().name())
                .addValue("keyword", query.keyword() == null
                        ? null : "%" + query.keyword().toLowerCase(java.util.Locale.ROOT) + "%")
                .addValue("fromInclusive", query.fromInclusive())
                .addValue("toExclusive", query.toExclusive())
                .addValue("size", query.size())
                .addValue("offset", query.page() * query.size());
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId,
            UUID id,
            ProductBundleService.BundleInput input,
            ProductBundleService.Actor actor) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id)
                .addValue("businessCode", input.businessCode())
                .addValue("businessCodeKey", input.businessCodeKey())
                .addValue("name", input.name())
                .addValue("description", input.description())
                .addValue("status", input.status().name())
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static BundleRow mapRow(ResultSet resultSet, int row)
            throws SQLException {
        return new BundleRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("business_code"),
                resultSet.getString("name"),
                resultSet.getString("description"),
                ProductStatus.valueOf(resultSet.getString("status")),
                resultSet.getLong("version"),
                resultSet.getString("created_by_display_name"),
                resultSet.getString("updated_by_display_name"),
                resultSet.getObject("created_at", OffsetDateTime.class).toInstant(),
                resultSet.getObject("updated_at", OffsetDateTime.class).toInstant());
    }

    private record BundleRow(
            UUID id,
            String businessCode,
            String name,
            String description,
            ProductStatus status,
            long version,
            String createdByDisplayName,
            String updatedByDisplayName,
            java.time.Instant createdAt,
            java.time.Instant updatedAt) {
        ProductBundleRecord record(
                List<ProductBundleRecord.Component> components) {
            return new ProductBundleRecord(
                    id, businessCode, name, description, status, components,
                    version, createdByDisplayName, updatedByDisplayName,
                    createdAt, updatedAt);
        }
    }
}
