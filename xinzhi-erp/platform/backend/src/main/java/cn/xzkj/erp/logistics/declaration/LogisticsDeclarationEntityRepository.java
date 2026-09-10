package cn.xzkj.erp.logistics.declaration;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.logistics.declaration.LogisticsDeclarationEntityRecord.ShopBinding;

@Repository
public class LogisticsDeclarationEntityRepository {
    private static final String LIST_SQL = """
            select e.id, e.name, e.enterprise_code, e.lifecycle_status,
                   e.version, e.created_at, e.updated_at
              from tenant_logistics_declaration_entities e
             where e.tenant_id = :tenantId
               and (cast(:status as varchar) is null or e.lifecycle_status = :status)
               and (cast(:keyword as varchar) is null or
                    (:searchField = 'NAME' and lower(e.name) like :keyword escape '\\') or
                    (:searchField = 'CODE' and lower(e.enterprise_code) like :keyword escape '\\') or
                    (:searchField = 'PLATFORM' and exists (
                        select 1
                          from tenant_logistics_declaration_entity_shops binding
                          join tenant_shops shop
                            on shop.tenant_id = binding.tenant_id
                           and shop.id = binding.shop_id
                          join platform_catalog platform on platform.id = shop.platform_id
                         where binding.tenant_id = e.tenant_id
                           and binding.declaration_entity_id = e.id
                           and lower(platform.display_name || ' ' || platform.code)
                               like :keyword escape '\\'
                    )) or
                    (:searchField = 'SHOP' and exists (
                        select 1
                          from tenant_logistics_declaration_entity_shops binding
                          join tenant_shops shop
                            on shop.tenant_id = binding.tenant_id
                           and shop.id = binding.shop_id
                         where binding.tenant_id = e.tenant_id
                           and binding.declaration_entity_id = e.id
                           and lower(shop.display_name) like :keyword escape '\\'
                    )))
             order by e.updated_at desc, e.id desc
             limit :limit offset :offset
            """;
    private static final String COUNT_SQL = """
            select count(*)
              from tenant_logistics_declaration_entities e
             where e.tenant_id = :tenantId
               and (cast(:status as varchar) is null or e.lifecycle_status = :status)
               and (cast(:keyword as varchar) is null or
                    (:searchField = 'NAME' and lower(e.name) like :keyword escape '\\') or
                    (:searchField = 'CODE' and lower(e.enterprise_code) like :keyword escape '\\') or
                    (:searchField = 'PLATFORM' and exists (
                        select 1
                          from tenant_logistics_declaration_entity_shops binding
                          join tenant_shops shop
                            on shop.tenant_id = binding.tenant_id
                           and shop.id = binding.shop_id
                          join platform_catalog platform on platform.id = shop.platform_id
                         where binding.tenant_id = e.tenant_id
                           and binding.declaration_entity_id = e.id
                           and lower(platform.display_name || ' ' || platform.code)
                               like :keyword escape '\\'
                    )) or
                    (:searchField = 'SHOP' and exists (
                        select 1
                          from tenant_logistics_declaration_entity_shops binding
                          join tenant_shops shop
                            on shop.tenant_id = binding.tenant_id
                           and shop.id = binding.shop_id
                         where binding.tenant_id = e.tenant_id
                           and binding.declaration_entity_id = e.id
                           and lower(shop.display_name) like :keyword escape '\\'
                    )))
            """;
    private static final String FIND_SQL = """
            select e.id, e.name, e.enterprise_code, e.lifecycle_status,
                   e.version, e.created_at, e.updated_at
              from tenant_logistics_declaration_entities e
             where e.tenant_id = :tenantId and e.id = :id
            """;
    private static final String BINDINGS_SQL = """
            select binding.declaration_entity_id, shop.id as shop_id,
                   shop.display_name as shop_name, shop.status as shop_status,
                   platform.code as platform_code,
                   platform.display_name as platform_name
              from tenant_logistics_declaration_entity_shops binding
              join tenant_shops shop
                on shop.tenant_id = binding.tenant_id
               and shop.id = binding.shop_id
              join platform_catalog platform on platform.id = shop.platform_id
             where binding.tenant_id = :tenantId
               and binding.declaration_entity_id in (:entityIds)
             order by platform.display_name, shop.display_name, shop.id
            """;
    private static final String SHOP_OPTIONS_SQL = """
            select shop.id as shop_id, shop.display_name as shop_name,
                   shop.status as shop_status, platform.code as platform_code,
                   platform.display_name as platform_name
              from tenant_shops shop
              join platform_catalog platform on platform.id = shop.platform_id
             where shop.tenant_id = :tenantId
               and shop.status <> 'ARCHIVED'
               and platform.status <> 'ARCHIVED'
               and (cast(:keyword as varchar) is null or lower(
                    shop.display_name || ' ' || platform.display_name || ' '
                    || platform.code) like :keyword escape '\\')
             order by platform.display_name, shop.display_name, shop.id
             limit :limit offset :offset
            """;
    private static final String SHOP_OPTIONS_COUNT_SQL = """
            select count(*)
              from tenant_shops shop
              join platform_catalog platform on platform.id = shop.platform_id
             where shop.tenant_id = :tenantId
               and shop.status <> 'ARCHIVED'
               and platform.status <> 'ARCHIVED'
               and (cast(:keyword as varchar) is null or lower(
                    shop.display_name || ' ' || platform.display_name || ' '
                    || platform.code) like :keyword escape '\\')
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public LogisticsDeclarationEntityRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<LogisticsDeclarationEntityRecord> list(
            UUID tenantId, String status, String searchField, String keyword,
            Pageable pageable) {
        MapSqlParameterSource parameters = listParameters(
                tenantId, status, searchField, keyword, pageable);
        List<EntityRow> rows = jdbc.query(LIST_SQL, parameters,
                LogisticsDeclarationEntityRepository::mapEntity);
        Long total = jdbc.queryForObject(COUNT_SQL, parameters, Long.class);
        Map<UUID, List<ShopBinding>> bindings = loadBindings(
                tenantId, rows.stream().map(EntityRow::id).toList());
        List<LogisticsDeclarationEntityRecord> items = rows.stream()
                .map(row -> record(row, bindings.getOrDefault(row.id(), List.of())))
                .toList();
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    public LogisticsDeclarationEntityRecord find(UUID tenantId, UUID id) {
        EntityRow row = jdbc.query(FIND_SQL,
                new MapSqlParameterSource().addValue("tenantId", tenantId)
                        .addValue("id", id),
                LogisticsDeclarationEntityRepository::mapEntity)
                .stream().findFirst().orElse(null);
        if (row == null) return null;
        return record(row, loadBindings(tenantId, List.of(id))
                .getOrDefault(id, List.of()));
    }

    public Page<ShopOption> listShopOptions(
            UUID tenantId, String keyword, Pageable pageable) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ShopOption> items = jdbc.query(SHOP_OPTIONS_SQL, parameters,
                LogisticsDeclarationEntityRepository::mapShopOption);
        Long total = jdbc.queryForObject(
                SHOP_OPTIONS_COUNT_SQL, parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    public long countBindableShops(UUID tenantId, Set<UUID> shopIds) {
        if (shopIds.isEmpty()) return 0;
        Long count = jdbc.queryForObject("""
                select count(*)
                  from tenant_shops shop
                  join platform_catalog platform on platform.id = shop.platform_id
                 where shop.tenant_id = :tenantId
                   and shop.id in (:shopIds)
                   and shop.status <> 'ARCHIVED'
                   and platform.status <> 'ARCHIVED'
                """, new MapSqlParameterSource().addValue("tenantId", tenantId)
                .addValue("shopIds", shopIds), Long.class);
        return count == null ? 0 : count;
    }

    public void insert(
            UUID id, UUID tenantId,
            LogisticsDeclarationEntityService.EntityInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        jdbc.update("""
                insert into tenant_logistics_declaration_entities (
                    id, tenant_id, name, enterprise_code,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :name, :enterpriseCode,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(id, tenantId, value, userId, systemAdminId, requestId));
        replaceShopBindings(tenantId, id, value.shopIds());
    }

    public boolean update(
            UUID id, UUID tenantId, long version,
            LogisticsDeclarationEntityService.EntityInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        boolean updated = jdbc.update("""
                update tenant_logistics_declaration_entities
                   set name = :name, enterprise_code = :enterpriseCode,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                """, parameters(id, tenantId, value, userId, systemAdminId, requestId)
                .addValue("version", version)) == 1;
        if (updated) replaceShopBindings(tenantId, id, value.shopIds());
        return updated;
    }

    public boolean archive(
            UUID tenantId, UUID id, long version,
            UUID userId, UUID systemAdminId, String requestId) {
        return jdbc.update("""
                update tenant_logistics_declaration_entities
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("id", id)
                .addValue("version", version).addValue("userId", userId)
                .addValue("systemAdminId", systemAdminId)
                .addValue("requestId", requestId)) == 1;
    }

    private void replaceShopBindings(UUID tenantId, UUID entityId, Set<UUID> shopIds) {
        jdbc.update("""
                delete from tenant_logistics_declaration_entity_shops
                 where tenant_id = :tenantId and declaration_entity_id = :entityId
                """, new MapSqlParameterSource().addValue("tenantId", tenantId)
                .addValue("entityId", entityId));
        if (shopIds.isEmpty()) return;
        SqlParameterSource[] batch = shopIds.stream()
                .map(shopId -> new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("entityId", entityId)
                        .addValue("shopId", shopId))
                .toArray(SqlParameterSource[]::new);
        jdbc.batchUpdate("""
                insert into tenant_logistics_declaration_entity_shops (
                    tenant_id, declaration_entity_id, shop_id
                ) values (:tenantId, :entityId, :shopId)
                """, batch);
    }

    private Map<UUID, List<ShopBinding>> loadBindings(
            UUID tenantId, List<UUID> entityIds) {
        if (entityIds.isEmpty()) return Map.of();
        Map<UUID, List<ShopBinding>> result = new LinkedHashMap<>();
        jdbc.query(BINDINGS_SQL, new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("entityIds", entityIds),
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    result.computeIfAbsent(
                            rs.getObject("declaration_entity_id", UUID.class),
                            ignored -> new ArrayList<>()).add(mapShopBinding(rs));
                });
        return result;
    }

    private static MapSqlParameterSource listParameters(
            UUID tenantId, String status, String searchField, String keyword,
            Pageable pageable) {
        return new MapSqlParameterSource().addValue("tenantId", tenantId)
                .addValue("status", status).addValue("searchField", searchField)
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
    }

    private static MapSqlParameterSource parameters(
            UUID id, UUID tenantId,
            LogisticsDeclarationEntityService.EntityInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        return new MapSqlParameterSource().addValue("id", id)
                .addValue("tenantId", tenantId).addValue("name", value.name())
                .addValue("enterpriseCode", value.enterpriseCode())
                .addValue("userId", userId).addValue("systemAdminId", systemAdminId)
                .addValue("requestId", requestId);
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.toLowerCase(java.util.Locale.ROOT)
                .replace("\\", "\\\\").replace("%", "\\%")
                .replace("_", "\\_") + "%";
    }

    private static EntityRow mapEntity(ResultSet rs, int row) throws SQLException {
        return new EntityRow(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getString("enterprise_code"), rs.getString("lifecycle_status"),
                rs.getLong("version"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static ShopOption mapShopOption(ResultSet rs, int row)
            throws SQLException {
        return new ShopOption(rs.getObject("shop_id", UUID.class),
                rs.getString("shop_name"), rs.getString("shop_status"),
                rs.getString("platform_code"), rs.getString("platform_name"));
    }

    private static ShopBinding mapShopBinding(ResultSet rs) throws SQLException {
        return new ShopBinding(rs.getObject("shop_id", UUID.class),
                rs.getString("shop_name"), rs.getString("shop_status"),
                rs.getString("platform_code"), rs.getString("platform_name"));
    }

    private static LogisticsDeclarationEntityRecord record(
            EntityRow row, List<ShopBinding> shops) {
        return new LogisticsDeclarationEntityRecord(row.id(), row.name(),
                row.enterpriseCode(), shops, row.status(), row.version(),
                row.createdAt(), row.updatedAt());
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    private record EntityRow(UUID id, String name, String enterpriseCode,
            String status, long version, Instant createdAt, Instant updatedAt) {
    }

    public record ShopOption(UUID id, String name, String status,
            String platformCode, String platformName) {
    }
}
