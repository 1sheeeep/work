package cn.xzkj.erp.settings.exception;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class OrderExceptionCategoryRepository {
    private final NamedParameterJdbcTemplate jdbc;

    OrderExceptionCategoryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    OrderExceptionCategoryRecord find(UUID tenantId) {
        Optional<SetRow> set = jdbc.query("""
                select revision, updated_by_display_name, created_at, updated_at
                  from tenant_order_exception_category_sets
                 where tenant_id = :tenantId
                """, new MapSqlParameterSource("tenantId", tenantId),
                OrderExceptionCategoryRepository::mapSet).stream().findFirst();
        if (set.isEmpty()) {
            return new OrderExceptionCategoryRecord(false, 0, null, null, null,
                    List.of());
        }
        List<OrderExceptionCategoryRecord.Category> items = jdbc.query("""
                select id, name, handling_guidance, enabled, sort_order,
                       created_at, updated_at
                  from tenant_order_exception_categories
                 where tenant_id = :tenantId
                 order by sort_order, id
                """, new MapSqlParameterSource("tenantId", tenantId),
                OrderExceptionCategoryRepository::mapCategory);
        SetRow row = set.get();
        return new OrderExceptionCategoryRecord(true, row.revision(),
                row.updatedByDisplayName(), row.createdAt(), row.updatedAt(), items);
    }

    void insertSet(UUID tenantId, OrderExceptionCategoryService.Actor actor) {
        jdbc.update("""
                insert into tenant_order_exception_category_sets (
                    tenant_id, revision, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, 0, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, actorParameters(tenantId, actor));
    }

    boolean updateSet(UUID tenantId, long expectedRevision,
            OrderExceptionCategoryService.Actor actor) {
        return jdbc.update("""
                update tenant_order_exception_category_sets
                   set revision = revision + 1,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       updated_at = now()
                 where tenant_id = :tenantId and revision = :revision
                """, actorParameters(tenantId, actor)
                .addValue("revision", expectedRevision)) == 1;
    }

    void replaceItems(UUID tenantId,
            List<OrderExceptionCategoryService.CategoryInput> items,
            OrderExceptionCategoryService.Actor actor) {
        jdbc.update("""
                delete from tenant_order_exception_categories
                 where tenant_id = :tenantId
                """, new MapSqlParameterSource("tenantId", tenantId));
        for (int index = 0; index < items.size(); index++) {
            OrderExceptionCategoryService.CategoryInput item = items.get(index);
            jdbc.update("""
                    insert into tenant_order_exception_categories (
                        id, tenant_id, name, name_key, handling_guidance,
                        enabled, sort_order, created_by_user_id,
                        created_by_system_admin_id, updated_by_user_id,
                        updated_by_system_admin_id
                    ) values (
                        :id, :tenantId, :name, :nameKey, :guidance,
                        :enabled, :sortOrder, :userId, :systemAdminId,
                        :userId, :systemAdminId
                    )
                    """, actorParameters(tenantId, actor)
                    .addValue("id", item.id())
                    .addValue("name", item.name())
                    .addValue("nameKey", item.nameKey())
                    .addValue("guidance", item.handlingGuidance())
                    .addValue("enabled", item.enabled())
                    .addValue("sortOrder", index));
        }
    }

    private static MapSqlParameterSource actorParameters(UUID tenantId,
            OrderExceptionCategoryService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static SetRow mapSet(ResultSet resultSet, int row) throws SQLException {
        return new SetRow(resultSet.getLong("revision"),
                resultSet.getString("updated_by_display_name"),
                instant(resultSet, "created_at"), instant(resultSet, "updated_at"));
    }

    private static OrderExceptionCategoryRecord.Category mapCategory(
            ResultSet resultSet, int row) throws SQLException {
        return new OrderExceptionCategoryRecord.Category(
                resultSet.getObject("id", UUID.class), resultSet.getString("name"),
                resultSet.getString("handling_guidance"),
                resultSet.getBoolean("enabled"), resultSet.getInt("sort_order"),
                instant(resultSet, "created_at"), instant(resultSet, "updated_at"));
    }

    private static java.time.Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        return resultSet.getObject(column, OffsetDateTime.class).toInstant();
    }

    private record SetRow(long revision, String updatedByDisplayName,
            java.time.Instant createdAt, java.time.Instant updatedAt) {
    }
}
