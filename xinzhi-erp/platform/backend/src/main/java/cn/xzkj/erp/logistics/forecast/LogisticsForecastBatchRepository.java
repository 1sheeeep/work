package cn.xzkj.erp.logistics.forecast;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
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
class LogisticsForecastBatchRepository {
    private static final String SELECT = """
            select id, batch_no, batch_type, forwarder, order_references,
                   order_count, total_weight_kg, forecast_status, printed,
                   result_message, created_by_display_name, version,
                   created_at, updated_at
              from tenant_logistics_forecast_batches forecast_batch
            """;
    private final NamedParameterJdbcTemplate jdbc;

    LogisticsForecastBatchRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<LogisticsForecastBatchRecord> list(UUID tenantId,
            LogisticsForecastBatchService.Filters filters, Pageable pageable) {
        StringBuilder where = new StringBuilder(
                " where forecast_batch.tenant_id = :tenantId");
        addLike(where, filters.batchType(), "forecast_batch.batch_type", "batchType");
        addLike(where, filters.creator(), "forecast_batch.created_by_display_name", "creator");
        addLike(where, filters.keyword(), "forecast_batch.order_references", "keyword");
        addLike(where, filters.forwarder(), "forecast_batch.forwarder", "forwarder");
        if (filters.status() != null) {
            where.append(" and forecast_batch.forecast_status = :status");
        }
        if (filters.printed() != null) {
            where.append(" and forecast_batch.printed = :printed");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("batchType", pattern(filters.batchType()))
                .addValue("creator", pattern(filters.creator()))
                .addValue("keyword", pattern(filters.keyword()))
                .addValue("forwarder", pattern(filters.forwarder()))
                .addValue("status", filters.status())
                .addValue("printed", filters.printed())
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsForecastBatchRecord> items = jdbc.query(
                SELECT + where
                        + " order by forecast_batch.updated_at desc, forecast_batch.id desc"
                        + " limit :limit offset :offset",
                parameters, LogisticsForecastBatchRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_forecast_batches forecast_batch"
                        + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    LogisticsForecastBatchRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT
                        + " where forecast_batch.tenant_id = :tenantId"
                        + " and forecast_batch.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                LogisticsForecastBatchRepository::map)
                .stream().findFirst().orElse(null);
    }

    void insert(UUID id, UUID tenantId, String batchNo,
            LogisticsForecastBatchService.BatchInput value,
            LogisticsForecastBatchService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_forecast_batches (
                    id, tenant_id, batch_no, batch_type, forwarder,
                    order_references, order_count, total_weight_kg,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :batchNo, :batchType, :forwarder,
                    :orderReferences, :orderCount, :totalWeightKg,
                    :displayName, :userId, :systemAdminId, :userId,
                    :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("batchNo", batchNo)
                .addValue("batchType", value.batchType())
                .addValue("forwarder", value.forwarder())
                .addValue("orderReferences", String.join(",", value.orderReferences()))
                .addValue("orderCount", value.orderReferences().size())
                .addValue("totalWeightKg", value.totalWeightKg()));
    }

    boolean updateStatus(UUID tenantId, UUID id, long version,
            String targetStatus, String resultMessage,
            LogisticsForecastBatchService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_forecast_batches
                   set forecast_status = :targetStatus,
                       result_message = :resultMessage,
                       printed = case when :targetStatus = 'SUCCEEDED'
                                      then printed else false end,
                       version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and ((forecast_status = 'PENDING'
                         and :targetStatus in ('SUCCEEDED', 'FAILED'))
                        or (forecast_status = 'FAILED'
                            and :targetStatus = 'PENDING'))
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)
                .addValue("targetStatus", targetStatus)
                .addValue("resultMessage", resultMessage)) == 1;
    }

    boolean markPrinted(UUID tenantId, UUID id, long version,
            LogisticsForecastBatchService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_forecast_batches
                   set printed = true, version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and forecast_status = 'SUCCEEDED' and printed = false
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    private static void addLike(StringBuilder where, String value,
            String column, String parameter) {
        if (value != null) {
            where.append(" and lower(").append(column).append(") like :")
                    .append(parameter).append(" escape '\\'");
        }
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            LogisticsForecastBatchService.Actor actor) {
        return new MapSqlParameterSource().addValue("id", id)
                .addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static LogisticsForecastBatchRecord map(ResultSet rs, int row)
            throws SQLException {
        return new LogisticsForecastBatchRecord(
                rs.getObject("id", UUID.class), rs.getString("batch_no"),
                rs.getString("batch_type"), rs.getString("forwarder"),
                Arrays.asList(rs.getString("order_references").split(",")),
                rs.getInt("order_count"), rs.getBigDecimal("total_weight_kg"),
                rs.getString("forecast_status"), rs.getBoolean("printed"),
                rs.getString("result_message"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
