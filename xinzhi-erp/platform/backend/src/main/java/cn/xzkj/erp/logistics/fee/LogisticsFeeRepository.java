package cn.xzkj.erp.logistics.fee;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class LogisticsFeeRepository {
    private static final String SELECT = """
            select id, platform_name, shop_name, channel_name,
                   order_reference, tracking_reference, transaction_reference,
                   estimated_fee, actual_fee, currency, carrier_weight_kg,
                   warehouse_weight_kg, shipped_on, confirmation_status,
                   lifecycle_status, note, confirmed_by_display_name,
                   confirmed_at, created_by_display_name, version,
                   created_at, updated_at
              from tenant_logistics_fee_records fee_record
            """;
    private final NamedParameterJdbcTemplate jdbc;

    LogisticsFeeRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<LogisticsFeeRecord> list(UUID tenantId,
            LogisticsFeeService.Filters filters, Pageable pageable) {
        StringBuilder where = new StringBuilder(
                " where fee_record.tenant_id = :tenantId");
        where.append(" and fee_record.lifecycle_status = :lifecycleStatus");
        if (filters.confirmationStatus() != null) {
            where.append(" and fee_record.confirmation_status = :confirmationStatus");
        }
        addLike(where, filters.platform(), "fee_record.platform_name", "platform");
        addLike(where, filters.shop(), "fee_record.shop_name", "shop");
        addLike(where, filters.channel(), "fee_record.channel_name", "channel");
        if (filters.keyword() != null) {
            where.append(" and lower(")
                    .append(searchColumn(filters.searchField()))
                    .append(") like :keyword escape '\\'");
        }
        if (filters.hasActualFee() != null) {
            where.append(filters.hasActualFee()
                    ? " and fee_record.actual_fee is not null"
                    : " and fee_record.actual_fee is null");
        }
        if (filters.shippedFrom() != null) {
            where.append(" and fee_record.shipped_on >= :shippedFrom");
        }
        if (filters.shippedTo() != null) {
            where.append(" and fee_record.shipped_on <= :shippedTo");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("lifecycleStatus", filters.lifecycleStatus())
                .addValue("confirmationStatus", filters.confirmationStatus())
                .addValue("platform", pattern(filters.platform()))
                .addValue("shop", pattern(filters.shop()))
                .addValue("channel", pattern(filters.channel()))
                .addValue("keyword", pattern(filters.keyword()))
                .addValue("shippedFrom", filters.shippedFrom())
                .addValue("shippedTo", filters.shippedTo())
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsFeeRecord> items = jdbc.query(
                SELECT + where
                        + " order by fee_record.shipped_on desc, fee_record.updated_at desc, fee_record.id desc"
                        + " limit :limit offset :offset",
                parameters, LogisticsFeeRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_fee_records fee_record" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    LogisticsFeeRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT
                        + " where fee_record.tenant_id = :tenantId and fee_record.id = :id",
                Map.of("tenantId", tenantId, "id", id), LogisticsFeeRepository::map)
                .stream().findFirst().orElse(null);
    }

    void insert(UUID id, UUID tenantId, LogisticsFeeService.FeeInput value,
            LogisticsFeeService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_fee_records (
                    id, tenant_id, platform_name, shop_name, channel_name,
                    order_reference, tracking_reference, transaction_reference,
                    estimated_fee, actual_fee, currency, carrier_weight_kg,
                    warehouse_weight_kg, shipped_on, note,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :platformName, :shopName, :channelName,
                    :orderReference, :trackingReference, :transactionReference,
                    :estimatedFee, :actualFee, :currency, :carrierWeightKg,
                    :warehouseWeightKg, :shippedOn, :note,
                    :displayName, :userId, :systemAdminId, :userId,
                    :systemAdminId, :requestId
                )
                """, values(id, tenantId, value, actor));
    }

    boolean update(UUID tenantId, UUID id, long version,
            LogisticsFeeService.FeeInput value, LogisticsFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_fee_records
                   set platform_name = :platformName, shop_name = :shopName,
                       channel_name = :channelName,
                       order_reference = :orderReference,
                       tracking_reference = :trackingReference,
                       transaction_reference = :transactionReference,
                       estimated_fee = :estimatedFee, actual_fee = :actualFee,
                       currency = :currency, carrier_weight_kg = :carrierWeightKg,
                       warehouse_weight_kg = :warehouseWeightKg,
                       shipped_on = :shippedOn, note = :note,
                       version = version + 1, updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                   and confirmation_status = 'UNCONFIRMED'
                """, values(id, tenantId, value, actor)
                .addValue("version", version)) == 1;
    }

    boolean confirm(UUID tenantId, UUID id, long version,
            LogisticsFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_fee_records
                   set confirmation_status = 'CONFIRMED',
                       confirmed_by_display_name = :displayName,
                       confirmed_by_user_id = :userId,
                       confirmed_by_system_admin_id = :systemAdminId,
                       confirmed_at = now(), version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                   and confirmation_status = 'UNCONFIRMED'
                   and actual_fee is not null
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    boolean archive(UUID tenantId, UUID id, long version,
            LogisticsFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_fee_records
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                   and confirmation_status = 'UNCONFIRMED'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource values(UUID id, UUID tenantId,
            LogisticsFeeService.FeeInput value, LogisticsFeeService.Actor actor) {
        return actorParameters(id, tenantId, actor)
                .addValue("platformName", value.platformName())
                .addValue("shopName", value.shopName())
                .addValue("channelName", value.channelName())
                .addValue("orderReference", value.orderReference())
                .addValue("trackingReference", value.trackingReference())
                .addValue("transactionReference", value.transactionReference())
                .addValue("estimatedFee", value.estimatedFee())
                .addValue("actualFee", value.actualFee())
                .addValue("currency", value.currency())
                .addValue("carrierWeightKg", value.carrierWeightKg())
                .addValue("warehouseWeightKg", value.warehouseWeightKg())
                .addValue("shippedOn", value.shippedOn())
                .addValue("note", value.note());
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            LogisticsFeeService.Actor actor) {
        return new MapSqlParameterSource().addValue("id", id)
                .addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static void addLike(StringBuilder where, String value,
            String column, String parameter) {
        if (value != null) {
            where.append(" and lower(").append(column).append(") like :")
                    .append(parameter).append(" escape '\\'");
        }
    }

    private static String searchColumn(String searchField) {
        return switch (searchField) {
            case "TRACKING_NO" -> "fee_record.tracking_reference";
            case "TRANSACTION_NO" -> "fee_record.transaction_reference";
            default -> "fee_record.order_reference";
        };
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static LogisticsFeeRecord map(ResultSet rs, int row)
            throws SQLException {
        OffsetDateTime confirmedAt = rs.getObject("confirmed_at", OffsetDateTime.class);
        return new LogisticsFeeRecord(
                rs.getObject("id", UUID.class), rs.getString("platform_name"),
                rs.getString("shop_name"), rs.getString("channel_name"),
                rs.getString("order_reference"), rs.getString("tracking_reference"),
                rs.getString("transaction_reference"), rs.getBigDecimal("estimated_fee"),
                rs.getBigDecimal("actual_fee"), rs.getString("currency"),
                rs.getBigDecimal("carrier_weight_kg"),
                rs.getBigDecimal("warehouse_weight_kg"),
                rs.getDate("shipped_on").toLocalDate(),
                rs.getString("confirmation_status"),
                rs.getString("lifecycle_status"), rs.getString("note"),
                rs.getString("confirmed_by_display_name"),
                confirmedAt == null ? null : confirmedAt.toInstant(),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
