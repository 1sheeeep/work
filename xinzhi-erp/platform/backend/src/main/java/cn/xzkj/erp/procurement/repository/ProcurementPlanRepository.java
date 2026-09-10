package cn.xzkj.erp.procurement.repository;

import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.service.ProcurementPlanView;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.LocationOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.SkuOption;
import cn.xzkj.erp.procurement.service.ProcurementReferenceViews.WarehouseOption;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProcurementPlanRepository {
    private static final String PLAN_SELECT = """
            SELECT plan.id, plan.plan_no, plan.status, plan.source,
                   plan.sku_id, plan.sku_code_snapshot, plan.sku_name_snapshot,
                   plan.sku_variant_snapshot, plan.warehouse_id,
                   plan.warehouse_code_snapshot, plan.warehouse_name_snapshot,
                   plan.location_id, plan.location_code_snapshot,
                   plan.location_name_snapshot, plan.quantity, plan.note,
                   plan.applicant_display_name, plan.void_reason,
                   plan.voided_by_display_name, plan.voided_at,
                   plan.version, plan.created_at, plan.updated_at
            FROM procurement_plans plan
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ProcurementPlanRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<ProcurementPlanView> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID locationId,
            ProcurementPlanStatus status,
            ProcurementPlanSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo,
            Pageable pageable) {
        String where = where(
                allWarehouses, warehouseId, locationId, status,
                searchField, keyword, createdFrom, createdTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("locationId", locationId)
                .addValue("status", status == null ? null : status.name())
                .addValue("keyword", keyword)
                .addValue("createdFrom", createdFrom)
                .addValue("createdTo", createdTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementPlanView> rows = jdbc.query(
                PLAN_SELECT + where
                        + " ORDER BY plan.created_at DESC, plan.id DESC"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                ProcurementPlanRepository::mapPlan);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_plans plan" + where,
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public long countByStatus(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            ProcurementPlanStatus status) {
        String warehouseFilter = allWarehouses
                ? ""
                : " AND warehouse_id IN (:warehouseScope)";
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_plans"
                        + " WHERE tenant_id = :tenantId"
                        + " AND status = :status"
                        + warehouseFilter,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseScope", warehouseScope)
                        .addValue("status", status.name()),
                Long.class);
        return total == null ? 0 : total;
    }

    public Optional<ProcurementPlanView> find(UUID tenantId, UUID planId) {
        return optionalQuery(
                PLAN_SELECT
                        + " WHERE plan.tenant_id = :tenantId"
                        + " AND plan.id = :planId",
                Map.of("tenantId", tenantId, "planId", planId),
                ProcurementPlanRepository::mapPlan);
    }

    public Optional<ProcurementPlanView> lock(UUID tenantId, UUID planId) {
        jdbc.query(
                "SELECT id FROM procurement_plans"
                        + " WHERE tenant_id = :tenantId AND id = :planId"
                        + " FOR UPDATE",
                Map.of("tenantId", tenantId, "planId", planId),
                (resultSet, rowNumber) -> resultSet.getObject(1, UUID.class));
        return find(tenantId, planId);
    }

    public Optional<CreateFacts> findCreateFacts(
            UUID tenantId, UUID skuId, UUID warehouseId, UUID locationId) {
        return optionalQuery(
                """
                SELECT sku.id AS sku_id, sku.business_code AS sku_code,
                       sku.name AS sku_name, sku.variant_summary,
                       warehouse.id AS warehouse_id,
                       warehouse.business_code AS warehouse_code,
                       warehouse.name AS warehouse_name,
                       location.id AS location_id,
                       location.business_code AS location_code,
                       location.name AS location_name
                FROM tenant_product_skus sku
                JOIN tenant_product_spus spu
                  ON spu.tenant_id = sku.tenant_id AND spu.id = sku.spu_id
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = sku.tenant_id
                 AND warehouse.id = :warehouseId
                JOIN tenant_warehouse_locations location
                  ON location.tenant_id = warehouse.tenant_id
                 AND location.warehouse_id = warehouse.id
                 AND location.id = :locationId
                 AND location.status = 'ACTIVE'
                WHERE sku.tenant_id = :tenantId AND sku.id = :skuId
                  AND sku.status = 'ACTIVE' AND spu.status = 'ACTIVE'
                  AND warehouse.status = 'ACTIVE'
                FOR SHARE OF sku, spu, warehouse, location
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("locationId", locationId),
                (resultSet, rowNumber) -> new CreateFacts(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("warehouse_code"),
                        resultSet.getString("warehouse_name"),
                        resultSet.getObject("location_id", UUID.class),
                        resultSet.getString("location_code"),
                        resultSet.getString("location_name")));
    }

    public void insert(
            UUID id,
            UUID tenantId,
            String planNo,
            CreateFacts facts,
            long quantity,
            String note,
            String applicantDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        insert(
                id, tenantId, planNo, ProcurementPlanSource.MANUAL, facts,
                quantity, note, applicantDisplayName, actorUserId,
                actorSystemAdminId);
    }

    public void insert(
            UUID id,
            UUID tenantId,
            String planNo,
            ProcurementPlanSource source,
            CreateFacts facts,
            long quantity,
            String note,
            String applicantDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        jdbc.update(
                """
                INSERT INTO procurement_plans (
                    id, tenant_id, plan_no, status, source,
                    sku_id, sku_code_snapshot, sku_name_snapshot,
                    sku_variant_snapshot, warehouse_id,
                    warehouse_code_snapshot, warehouse_name_snapshot,
                    location_id, location_code_snapshot,
                    location_name_snapshot, quantity, note,
                    applicant_display_name, applicant_user_id,
                    applicant_system_admin_id
                ) VALUES (
                    :id, :tenantId, :planNo, 'UNPURCHASED', :source,
                    :skuId, :skuCode, :skuName, :skuVariant,
                    :warehouseId, :warehouseCode, :warehouseName,
                    :locationId, :locationCode, :locationName,
                    :quantity, :note, :applicantDisplayName,
                    :actorUserId, :actorSystemAdminId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("tenantId", tenantId)
                        .addValue("planNo", planNo)
                        .addValue("source", source.name())
                        .addValue("skuId", facts.skuId())
                        .addValue("skuCode", facts.skuCode())
                        .addValue("skuName", facts.skuName())
                        .addValue("skuVariant", facts.skuVariant())
                        .addValue("warehouseId", facts.warehouseId())
                        .addValue("warehouseCode", facts.warehouseCode())
                        .addValue("warehouseName", facts.warehouseName())
                        .addValue("locationId", facts.locationId())
                        .addValue("locationCode", facts.locationCode())
                        .addValue("locationName", facts.locationName())
                        .addValue("quantity", quantity)
                        .addValue("note", note)
                        .addValue("applicantDisplayName", applicantDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId));
    }

    public int voidPlan(
            UUID tenantId,
            UUID planId,
            long expectedVersion,
            String reason,
            String actorDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        return jdbc.update(
                """
                UPDATE procurement_plans
                SET status = 'VOIDED', void_reason = :reason,
                    voided_by_display_name = :actorDisplayName,
                    voided_by_user_id = :actorUserId,
                    voided_by_system_admin_id = :actorSystemAdminId,
                    voided_at = now(), updated_at = now(),
                    version = version + 1
                WHERE tenant_id = :tenantId AND id = :planId
                  AND status = 'UNPURCHASED' AND version = :expectedVersion
                """,
                new MapSqlParameterSource()
                        .addValue("reason", reason)
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("tenantId", tenantId)
                        .addValue("planId", planId)
                        .addValue("expectedVersion", expectedVersion));
    }

    public int markOrdered(UUID tenantId, UUID planId, long expectedVersion) {
        return jdbc.update(
                """
                UPDATE procurement_plans
                SET status = 'ORDERED', updated_at = now(), version = version + 1
                WHERE tenant_id = :tenantId AND id = :planId
                  AND status = 'UNPURCHASED' AND version = :expectedVersion
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("planId", planId)
                        .addValue("expectedVersion", expectedVersion));
    }

    public Page<SkuOption> listSkuOptions(
            UUID tenantId, String keyword, Pageable pageable) {
        String filter = keyword == null ? "" : """
                 AND (lower(sku.business_code) LIKE '%' || :keyword || '%'
                   OR lower(sku.name) LIKE '%' || :keyword || '%'
                   OR lower(coalesce(sku.variant_summary, '')) LIKE '%' || :keyword || '%')
                """;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        String from = """
                FROM tenant_product_skus sku
                JOIN tenant_product_spus spu
                  ON spu.tenant_id = sku.tenant_id AND spu.id = sku.spu_id
                WHERE sku.tenant_id = :tenantId
                  AND sku.status = 'ACTIVE' AND spu.status = 'ACTIVE'
                """ + filter;
        List<SkuOption> rows = jdbc.query(
                "SELECT sku.id, sku.business_code, sku.name, sku.variant_summary " + from
                        + " ORDER BY sku.business_code, sku.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new SkuOption(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getString(2), resultSet.getString(3),
                        resultSet.getString(4)));
        Long total = jdbc.queryForObject("SELECT count(*) " + from, parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Page<WarehouseOption> listWarehouseOptions(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String keyword,
            Pageable pageable) {
        String scope = allWarehouses ? "" : " AND warehouse.id IN (:warehouseScope)";
        String filter = keyword == null ? "" : """
                 AND (lower(warehouse.business_code) LIKE '%' || :keyword || '%'
                   OR lower(warehouse.name) LIKE '%' || :keyword || '%')
                """;
        String where = " WHERE warehouse.tenant_id = :tenantId"
                + " AND warehouse.status = 'ACTIVE'" + scope + filter;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<WarehouseOption> rows = jdbc.query(
                "SELECT warehouse.id, warehouse.business_code, warehouse.name"
                        + " FROM tenant_warehouses warehouse" + where
                        + " ORDER BY warehouse.business_code, warehouse.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new WarehouseOption(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getString(2), resultSet.getString(3)));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM tenant_warehouses warehouse" + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Page<LocationOption> listLocationOptions(
            UUID tenantId, UUID warehouseId, String keyword, Pageable pageable) {
        String filter = keyword == null ? "" : """
                 AND (lower(location.business_code) LIKE '%' || :keyword || '%'
                   OR lower(location.name) LIKE '%' || :keyword || '%')
                """;
        String where = " WHERE location.tenant_id = :tenantId"
                + " AND location.warehouse_id = :warehouseId"
                + " AND location.status = 'ACTIVE'"
                + " AND warehouse.status = 'ACTIVE'" + filter;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseId", warehouseId)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LocationOption> rows = jdbc.query(
                "SELECT location.id, location.warehouse_id,"
                        + " location.business_code, location.name"
                        + " FROM tenant_warehouse_locations location"
                        + " JOIN tenant_warehouses warehouse"
                        + " ON warehouse.tenant_id = location.tenant_id"
                        + " AND warehouse.id = location.warehouse_id" + where
                        + " ORDER BY location.business_code, location.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new LocationOption(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getObject(2, UUID.class),
                        resultSet.getString(3), resultSet.getString(4)));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM tenant_warehouse_locations location"
                        + " JOIN tenant_warehouses warehouse"
                        + " ON warehouse.tenant_id = location.tenant_id"
                        + " AND warehouse.id = location.warehouse_id" + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":procurement-plan:" + commandId),
                Object.class);
    }

    public Optional<CommandRecord> findCommand(UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT plan_id, operation, request_fingerprint,
                       result_status, result_version
                FROM procurement_plan_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                Map.of("tenantId", tenantId, "commandId", commandId),
                (resultSet, rowNumber) -> new CommandRecord(
                        resultSet.getObject("plan_id", UUID.class),
                        resultSet.getString("operation"),
                        resultSet.getString("request_fingerprint"),
                        ProcurementPlanStatus.valueOf(
                                resultSet.getString("result_status")),
                        resultSet.getLong("result_version")));
    }

    public void insertCommand(
            UUID tenantId,
            UUID commandId,
            UUID planId,
            String operation,
            String fingerprint,
            ProcurementPlanStatus status,
            long version) {
        jdbc.update(
                """
                INSERT INTO procurement_plan_commands (
                    tenant_id, command_id, plan_id, operation,
                    request_fingerprint, result_status, result_version
                ) VALUES (
                    :tenantId, :commandId, :planId, :operation,
                    :fingerprint, :status, :version
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("planId", planId)
                        .addValue("operation", operation)
                        .addValue("fingerprint", fingerprint)
                        .addValue("status", status.name())
                        .addValue("version", version));
    }

    private static String where(
            boolean allWarehouses,
            UUID warehouseId,
            UUID locationId,
            ProcurementPlanStatus status,
            ProcurementPlanSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        StringBuilder where = new StringBuilder(
                " WHERE plan.tenant_id = :tenantId");
        if (!allWarehouses) where.append(" AND plan.warehouse_id IN (:warehouseScope)");
        if (warehouseId != null) where.append(" AND plan.warehouse_id = :warehouseId");
        if (locationId != null) where.append(" AND plan.location_id = :locationId");
        if (status != null) where.append(" AND plan.status = :status");
        if (keyword != null) {
            where.append(" AND lower(").append(switch (searchField) {
                case PLAN_NO -> "plan.plan_no";
                case SKU_CODE -> "plan.sku_code_snapshot";
                case SKU_NAME -> "plan.sku_name_snapshot";
                case NOTE -> "coalesce(plan.note, '')";
            }).append(") LIKE '%' || :keyword || '%'");
        }
        if (createdFrom != null) where.append(" AND plan.created_at >= :createdFrom");
        if (createdTo != null) where.append(" AND plan.created_at <= :createdTo");
        return where.toString();
    }

    private static ProcurementPlanView mapPlan(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new ProcurementPlanView(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("plan_no"),
                ProcurementPlanStatus.valueOf(resultSet.getString("status")),
                ProcurementPlanSource.valueOf(resultSet.getString("source")),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code_snapshot"),
                resultSet.getString("sku_name_snapshot"),
                resultSet.getString("sku_variant_snapshot"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code_snapshot"),
                resultSet.getString("warehouse_name_snapshot"),
                resultSet.getObject("location_id", UUID.class),
                resultSet.getString("location_code_snapshot"),
                resultSet.getString("location_name_snapshot"),
                resultSet.getLong("quantity"),
                resultSet.getString("note"),
                resultSet.getString("applicant_display_name"),
                instant(resultSet, "created_at"),
                resultSet.getString("void_reason"),
                resultSet.getString("voided_by_display_name"),
                instant(resultSet, "voided_at"),
                resultSet.getLong("version"),
                instant(resultSet, "updated_at"));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private <T> Optional<T> optionalQuery(
            String sql,
            Object parameters,
            org.springframework.jdbc.core.RowMapper<T> mapper) {
        try {
            T result;
            if (parameters instanceof MapSqlParameterSource source) {
                result = jdbc.queryForObject(sql, source, mapper);
            } else {
                @SuppressWarnings("unchecked")
                Map<String, ?> values = (Map<String, ?>) parameters;
                result = jdbc.queryForObject(sql, values, mapper);
            }
            return Optional.ofNullable(result);
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    public record CreateFacts(
            UUID skuId,
            String skuCode,
            String skuName,
            String skuVariant,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            UUID locationId,
            String locationCode,
            String locationName) {
    }

    public record CommandRecord(
            UUID planId,
            String operation,
            String fingerprint,
            ProcurementPlanStatus resultStatus,
            long resultVersion) {
    }
}
