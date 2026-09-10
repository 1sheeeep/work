package cn.xzkj.erp.iam.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Repository
public class AuditLogQueryRepository {

    private static final TypeReference<Map<String, String>> DETAILS_TYPE =
            new TypeReference<>() {
            };

    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public AuditLogQueryRepository(
            NamedParameterJdbcTemplate jdbc,
            ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public AuditPage find(
            UUID tenantId,
            String action,
            String resourceType,
            Instant from,
            Instant to,
            int page,
            int size) {
        StringBuilder where = new StringBuilder(" WHERE tenant_id = :tenantId");
        MapSqlParameterSource parameters =
                new MapSqlParameterSource("tenantId", tenantId);
        appendFilter(where, parameters, "action", action);
        appendFilter(where, parameters, "resource_type", resourceType);
        if (from != null) {
            where.append(" AND created_at >= :from");
            parameters.addValue("from", from);
        }
        if (to != null) {
            where.append(" AND created_at < :to");
            parameters.addValue("to", to);
        }

        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM audit_logs" + where,
                parameters,
                Long.class);
        parameters.addValue("limit", size);
        parameters.addValue("offset", Math.multiplyExact(page, size));
        List<AuditLogRecord> items = jdbc.query("""
                        SELECT id, actor_user_id, actor_system_admin_id,
                               action, resource_type,
                               resource_id, request_id, source_ip::text,
                               details::text, created_at
                        FROM audit_logs
                        """
                        + where
                        + " ORDER BY created_at DESC, id DESC"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                this::map);
        return new AuditPage(items, total == null ? 0 : total);
    }

    private static void appendFilter(
            StringBuilder where,
            MapSqlParameterSource parameters,
            String column,
            String value) {
        if (value != null) {
            where.append(" AND ").append(column).append(" = :").append(column);
            parameters.addValue(column, value);
        }
    }

    private AuditLogRecord map(ResultSet result, int rowNumber) throws SQLException {
        return new AuditLogRecord(
                result.getObject("id", UUID.class),
                result.getObject("actor_user_id", UUID.class),
                result.getObject("actor_system_admin_id", UUID.class),
                result.getString("action"),
                result.getString("resource_type"),
                result.getString("resource_id"),
                result.getString("request_id"),
                result.getString("source_ip"),
                readDetails(result.getString("details")),
                result.getTimestamp("created_at").toInstant());
    }

    private Map<String, String> readDetails(String json) throws SQLException {
        try {
            return objectMapper.readValue(json, DETAILS_TYPE);
        } catch (JacksonException invalidStoredJson) {
            throw new SQLException("Invalid audit details JSON", invalidStoredJson);
        }
    }

    public record AuditPage(List<AuditLogRecord> items, long totalElements) {

        public AuditPage {
            items = List.copyOf(items);
        }
    }
}
