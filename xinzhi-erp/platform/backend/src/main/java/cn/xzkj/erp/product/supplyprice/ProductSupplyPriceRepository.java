package cn.xzkj.erp.product.supplyprice;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.supplyprice.ProductSupplyPriceRecord.SkuType;

@Repository
class ProductSupplyPriceRepository {
    private final NamedParameterJdbcTemplate jdbc;

    ProductSupplyPriceRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ProductSupplyPriceService.PricePage list(
            UUID tenantId,
            ProductSupplyPriceService.PriceQuery query) {
        MapSqlParameterSource parameters = queryParameters(tenantId, query);
        String where = """
                 where price.tenant_id = :tenantId
                   and ((cast(:status as varchar) is null
                         and price.status <> 'ARCHIVED')
                        or price.status = cast(:status as varchar))
                   and (cast(:skuType as varchar) is null
                        or price.sku_type = cast(:skuType as varchar))
                   and (cast(:country as varchar) is null
                        or price.sales_country = cast(:country as varchar))
                   and (cast(:keyword as varchar) is null
                        or lower(coalesce(sku.business_code,
                                          bundle.business_code)) like :keyword
                        or lower(coalesce(sku.name, bundle.name)) like :keyword)
                """;
        String joins = """
                  left join tenant_product_skus sku
                    on price.sku_type = 'INVENTORY'
                   and sku.tenant_id = price.tenant_id
                   and sku.id = price.sku_id
                  left join tenant_product_bundles bundle
                    on price.sku_type = 'BUNDLE'
                   and bundle.tenant_id = price.tenant_id
                   and bundle.id = price.bundle_id
                """;
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_product_supply_prices price "
                        + joins + where,
                parameters, Long.class);
        List<ProductSupplyPriceRecord> items = jdbc.query("""
                select price.id, price.sku_type,
                       coalesce(price.sku_id, price.bundle_id) as reference_id,
                       coalesce(sku.business_code, bundle.business_code) as sku_code,
                       coalesce(sku.name, bundle.name) as sku_name,
                       price.sales_country, price.currency, price.unit_price,
                       price.minimum_quantity, price.valid_from, price.valid_to,
                       price.status, price.note, price.version,
                       price.created_by_display_name,
                       price.updated_by_display_name,
                       price.created_at, price.updated_at
                  from tenant_product_supply_prices price
                """ + joins + where + """
                 order by price.updated_at desc, sku_code, price.id
                 limit :size offset :offset
                """, parameters, ProductSupplyPriceRepository::mapRow);
        return new ProductSupplyPriceService.PricePage(
                items, query.page(), query.size(), total == null ? 0 : total);
    }

    Optional<ProductSupplyPriceRecord> find(UUID tenantId, UUID id) {
        return jdbc.query("""
                select price.id, price.sku_type,
                       coalesce(price.sku_id, price.bundle_id) as reference_id,
                       coalesce(sku.business_code, bundle.business_code) as sku_code,
                       coalesce(sku.name, bundle.name) as sku_name,
                       price.sales_country, price.currency, price.unit_price,
                       price.minimum_quantity, price.valid_from, price.valid_to,
                       price.status, price.note, price.version,
                       price.created_by_display_name,
                       price.updated_by_display_name,
                       price.created_at, price.updated_at
                  from tenant_product_supply_prices price
                  left join tenant_product_skus sku
                    on price.sku_type = 'INVENTORY'
                   and sku.tenant_id = price.tenant_id
                   and sku.id = price.sku_id
                  left join tenant_product_bundles bundle
                    on price.sku_type = 'BUNDLE'
                   and bundle.tenant_id = price.tenant_id
                   and bundle.id = price.bundle_id
                 where price.tenant_id = :tenantId and price.id = :id
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id), ProductSupplyPriceRepository::mapRow)
                .stream().findFirst();
    }

    boolean targetAvailable(UUID tenantId, SkuType type, UUID referenceId) {
        String table = type == SkuType.INVENTORY
                ? "tenant_product_skus" : "tenant_product_bundles";
        Boolean exists = jdbc.queryForObject("select exists (select 1 from "
                + table + " where tenant_id = :tenantId and id = :referenceId"
                + " and status <> 'ARCHIVED')",
                new MapSqlParameterSource("tenantId", tenantId)
                        .addValue("referenceId", referenceId), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    boolean overlaps(
            UUID tenantId,
            UUID excludedId,
            ProductSupplyPriceService.PriceInput input) {
        Boolean exists = jdbc.queryForObject("""
                select exists (
                    select 1 from tenant_product_supply_prices
                     where tenant_id = :tenantId
                       and id <> coalesce(cast(:excludedId as uuid),
                                         '00000000-0000-0000-0000-000000000000'::uuid)
                       and sku_type = :skuType
                       and ((:skuType = 'INVENTORY' and sku_id = :referenceId)
                            or (:skuType = 'BUNDLE' and bundle_id = :referenceId))
                       and sales_country = :country
                       and status <> 'ARCHIVED'
                       and valid_from <= coalesce(cast(:validTo as date), 'infinity'::date)
                       and coalesce(valid_to, 'infinity'::date) >= :validFrom
                )
                """, baseParameters(tenantId, input)
                .addValue("excludedId", excludedId), Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    void insert(
            UUID tenantId,
            UUID id,
            ProductSupplyPriceService.PriceInput input,
            ProductSupplyPriceService.Actor actor) {
        jdbc.update("""
                insert into tenant_product_supply_prices (
                    id, tenant_id, sku_type, sku_id, bundle_id,
                    sales_country, currency, unit_price, minimum_quantity,
                    valid_from, valid_to, status, note,
                    created_by_display_name, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :skuType, :skuId, :bundleId,
                    :country, :currency, :unitPrice, :minimumQuantity,
                    :validFrom, :validTo, :status, :note,
                    :displayName, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, mutationParameters(tenantId, id, input, actor));
    }

    boolean update(
            UUID tenantId,
            UUID id,
            long version,
            ProductSupplyPriceService.PriceInput input,
            ProductSupplyPriceService.Actor actor) {
        return jdbc.update("""
                update tenant_product_supply_prices
                   set currency = :currency,
                       unit_price = :unitPrice,
                       minimum_quantity = :minimumQuantity,
                       valid_from = :validFrom,
                       valid_to = :validTo,
                       status = :status,
                       note = :note,
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
                """, mutationParameters(tenantId, id, input, actor)
                .addValue("version", version)) == 1;
    }

    boolean archive(
            UUID tenantId,
            UUID id,
            long version,
            ProductSupplyPriceService.Actor actor) {
        return jdbc.update("""
                update tenant_product_supply_prices
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
                .addValue("id", id).addValue("version", version)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId())) == 1;
    }

    private static MapSqlParameterSource queryParameters(
            UUID tenantId,
            ProductSupplyPriceService.PriceQuery query) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("status", query.status() == null
                        ? null : query.status().name())
                .addValue("skuType", query.skuType() == null
                        ? null : query.skuType().name())
                .addValue("country", query.country())
                .addValue("keyword", query.keyword() == null ? null
                        : "%" + query.keyword().toLowerCase(Locale.ROOT) + "%")
                .addValue("size", query.size())
                .addValue("offset", query.page() * query.size());
    }

    private static MapSqlParameterSource baseParameters(
            UUID tenantId,
            ProductSupplyPriceService.PriceInput input) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("skuType", input.skuType().name())
                .addValue("referenceId", input.referenceId())
                .addValue("skuId", input.skuType() == SkuType.INVENTORY
                        ? input.referenceId() : null)
                .addValue("bundleId", input.skuType() == SkuType.BUNDLE
                        ? input.referenceId() : null)
                .addValue("country", input.salesCountry())
                .addValue("currency", input.currency())
                .addValue("unitPrice", input.unitPrice())
                .addValue("minimumQuantity", input.minimumQuantity())
                .addValue("validFrom", input.validFrom())
                .addValue("validTo", input.validTo())
                .addValue("status", input.status().name())
                .addValue("note", input.note());
    }

    private static MapSqlParameterSource mutationParameters(
            UUID tenantId,
            UUID id,
            ProductSupplyPriceService.PriceInput input,
            ProductSupplyPriceService.Actor actor) {
        return baseParameters(tenantId, input)
                .addValue("id", id)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static ProductSupplyPriceRecord mapRow(ResultSet rs, int row)
            throws SQLException {
        return new ProductSupplyPriceRecord(
                rs.getObject("id", UUID.class),
                SkuType.valueOf(rs.getString("sku_type")),
                rs.getObject("reference_id", UUID.class),
                rs.getString("sku_code"), rs.getString("sku_name"),
                rs.getString("sales_country"), rs.getString("currency"),
                rs.getObject("unit_price", BigDecimal.class),
                rs.getInt("minimum_quantity"),
                rs.getObject("valid_from", LocalDate.class),
                rs.getObject("valid_to", LocalDate.class),
                ProductStatus.valueOf(rs.getString("status")),
                rs.getString("note"), rs.getLong("version"),
                rs.getString("created_by_display_name"),
                rs.getString("updated_by_display_name"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
