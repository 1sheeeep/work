package cn.xzkj.erp.settings.alias;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ShopAliasRepository {
    private static final String FROM = """
             from tenant_shops shop
             join platform_catalog platform on platform.id = shop.platform_id
             left join tenant_shop_aliases alias
               on alias.tenant_id = shop.tenant_id and alias.shop_id = shop.id
            """;
    private static final String SELECT = """
            select shop.id as shop_id, shop.display_name as shop_display_name,
                   platform.code as platform_code,
                   alias.alias_en, alias.alias_zh_cn, alias.alias_es,
                   alias.alias_id, alias.alias_th, alias.alias_ru,
                   alias.alias_pt, alias.alias_vi, alias.alias_ms,
                   alias.shop_id is not null as configured,
                   coalesce(alias.version, 0) as version,
                   alias.updated_by_display_name, alias.updated_at
            """;

    private final NamedParameterJdbcTemplate jdbc;

    ShopAliasRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ShopAliasService.AliasPage list(UUID tenantId,
            ShopAliasService.AliasQuery query) {
        StringBuilder where = new StringBuilder("""
                 where shop.tenant_id = :tenantId and shop.status <> 'ARCHIVED'
                """);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("limit", query.size())
                .addValue("offset", query.page() * query.size());
        if (query.keyword() != null) {
            where.append("""
                     and (lower(shop.display_name) like :keyword
                       or lower(shop.external_shop_ref) like :keyword
                       or lower(platform.code) like :keyword
                       or lower(coalesce(alias.alias_en, '')) like :keyword
                       or lower(coalesce(alias.alias_zh_cn, '')) like :keyword
                       or lower(coalesce(alias.alias_es, '')) like :keyword
                       or lower(coalesce(alias.alias_id, '')) like :keyword
                       or lower(coalesce(alias.alias_th, '')) like :keyword
                       or lower(coalesce(alias.alias_ru, '')) like :keyword
                       or lower(coalesce(alias.alias_pt, '')) like :keyword
                       or lower(coalesce(alias.alias_vi, '')) like :keyword
                       or lower(coalesce(alias.alias_ms, '')) like :keyword)
                    """);
            parameters.addValue("keyword", "%" + query.keyword().toLowerCase(java.util.Locale.ROOT) + "%");
        }
        long total = jdbc.queryForObject("select count(*)" + FROM + where,
                parameters, Long.class);
        List<ShopAliasRecord> items = jdbc.query(SELECT + FROM + where
                + " order by shop.display_name, shop.id limit :limit offset :offset",
                parameters, ShopAliasRepository::map);
        return new ShopAliasService.AliasPage(items, query.page(), query.size(), total);
    }

    Optional<ShopAliasRecord> find(UUID tenantId, UUID shopId) {
        return jdbc.query(SELECT + FROM + """
                 where shop.tenant_id = :tenantId and shop.id = :shopId
                   and shop.status <> 'ARCHIVED'
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("shopId", shopId), ShopAliasRepository::map)
                .stream().findFirst();
    }

    void insert(UUID tenantId, UUID shopId, ShopAliasService.AliasInput input,
            ShopAliasService.Actor actor) {
        jdbc.update("""
                insert into tenant_shop_aliases (
                    tenant_id, shop_id, alias_en, alias_zh_cn, alias_es,
                    alias_id, alias_th, alias_ru, alias_pt, alias_vi, alias_ms,
                    updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :shopId, :aliasEn, :aliasZhCn, :aliasEs,
                    :aliasId, :aliasTh, :aliasRu, :aliasPt, :aliasVi, :aliasMs,
                    :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, shopId, input, actor));
    }

    boolean update(UUID tenantId, UUID shopId, long version,
            ShopAliasService.AliasInput input, ShopAliasService.Actor actor) {
        return jdbc.update("""
                update tenant_shop_aliases
                   set alias_en = :aliasEn, alias_zh_cn = :aliasZhCn,
                       alias_es = :aliasEs, alias_id = :aliasId,
                       alias_th = :aliasTh, alias_ru = :aliasRu,
                       alias_pt = :aliasPt, alias_vi = :aliasVi,
                       alias_ms = :aliasMs,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1, updated_at = now()
                 where tenant_id = :tenantId and shop_id = :shopId
                   and version = :version
                """, parameters(tenantId, shopId, input, actor)
                .addValue("version", version)) == 1;
    }

    Map<UUID, AliasNames> findAliases(UUID tenantId, Collection<UUID> shopIds) {
        if (shopIds == null || shopIds.isEmpty()) return Map.of();
        Map<UUID, AliasNames> result = new LinkedHashMap<>();
        jdbc.query("""
                select shop_id, alias_en, alias_zh_cn
                  from tenant_shop_aliases
                 where tenant_id = :tenantId and shop_id in (:shopIds)
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("shopIds", shopIds), (org.springframework.jdbc.core.RowCallbackHandler) row -> result.put(
                        row.getObject("shop_id", UUID.class),
                        new AliasNames(row.getString("alias_en"),
                                row.getString("alias_zh_cn"))));
        return Map.copyOf(result);
    }

    private static MapSqlParameterSource parameters(UUID tenantId, UUID shopId,
            ShopAliasService.AliasInput input, ShopAliasService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("shopId", shopId)
                .addValue("aliasEn", input.aliasEn())
                .addValue("aliasZhCn", input.aliasZhCn())
                .addValue("aliasEs", input.aliasEs())
                .addValue("aliasId", input.aliasId())
                .addValue("aliasTh", input.aliasTh())
                .addValue("aliasRu", input.aliasRu())
                .addValue("aliasPt", input.aliasPt())
                .addValue("aliasVi", input.aliasVi())
                .addValue("aliasMs", input.aliasMs())
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static ShopAliasRecord map(ResultSet row, int number)
            throws SQLException {
        OffsetDateTime updatedAt = row.getObject("updated_at", OffsetDateTime.class);
        return new ShopAliasRecord(
                row.getObject("shop_id", UUID.class),
                row.getString("shop_display_name"), row.getString("platform_code"),
                row.getString("alias_en"), row.getString("alias_zh_cn"),
                row.getString("alias_es"), row.getString("alias_id"),
                row.getString("alias_th"), row.getString("alias_ru"),
                row.getString("alias_pt"), row.getString("alias_vi"),
                row.getString("alias_ms"), row.getBoolean("configured"),
                row.getLong("version"), row.getString("updated_by_display_name"),
                updatedAt == null ? null : updatedAt.toInstant());
    }

    record AliasNames(String english, String chinese) {
    }
}
