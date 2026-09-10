package cn.xzkj.erp.warehouse.operations.repository;

import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementActor;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.BoxItem;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.BoxStock;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.MovementType;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.PriceSnapshot;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Settings;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Repository
public class ManualMovementWorkflowStore {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> OBJECT_MAP =
            new TypeReference<>() {
            };
    private final NamedParameterJdbcTemplate jdbc;

    public ManualMovementWorkflowStore(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void lockConfigurationCommand(
            UUID tenantId, UUID commandId) {
        String value = "manual-configuration:"
                + tenantId + ":" + commandId;
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock("
                        + "hashtextextended(:value, 0))",
                Map.of("value", value),
                Object.class);
    }

    public Optional<ConfigurationCommand> configurationCommand(
            UUID tenantId, UUID commandId) {
        return optional(
                """
                SELECT operation, request_fingerprint,
                       response_payload::text AS response_payload
                FROM inventory_manual_configuration_commands
                WHERE tenant_id = :tenantId
                  AND command_id = :commandId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId),
                (resultSet, rowNumber) -> new ConfigurationCommand(
                        resultSet.getString("operation"),
                        resultSet.getString("request_fingerprint"),
                        readPayload(resultSet.getString(
                                "response_payload"))));
    }

    public void insertConfigurationCommand(
            UUID tenantId,
            UUID commandId,
            String operation,
            String fingerprint,
            Map<String, Object> payload) {
        jdbc.update(
                """
                INSERT INTO inventory_manual_configuration_commands (
                    tenant_id, command_id, operation,
                    request_fingerprint, response_payload
                ) VALUES (
                    :tenantId, :commandId, :operation,
                    :fingerprint, CAST(:payload AS JSONB)
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("operation", operation)
                        .addValue("fingerprint", fingerprint)
                        .addValue("payload", JSON.writeValueAsString(payload)));
    }

    public Settings settings(
            UUID tenantId, ManualMovementDirection direction) {
        return optional(
                """
                SELECT direction, approval_required,
                       unit_price_required, show_cost_price,
                       cost_update_policy, contact_information_required,
                       version
                FROM inventory_manual_movement_settings
                WHERE tenant_id = :tenantId
                  AND direction = :direction
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("direction", direction.name()),
                ManualMovementWorkflowStore::mapSettings)
                .orElseGet(() -> new Settings(
                        direction,
                        false,
                        false,
                        false,
                        "NO_UPDATE",
                        false,
                        0));
    }

    public Settings saveSettings(
            UUID tenantId,
            ManualMovementDirection direction,
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            String costUpdatePolicy,
            boolean contactRequired,
            long expectedVersion,
            ManualMovementActor actor) {
        int updated = jdbc.update(
                """
                UPDATE inventory_manual_movement_settings
                SET approval_required = :approvalRequired,
                    unit_price_required = :unitPriceRequired,
                    show_cost_price = :showCostPrice,
                    cost_update_policy = :costUpdatePolicy,
                    contact_information_required = :contactRequired,
                    version = version + 1,
                    updated_by_user_id = :userId,
                    updated_by_system_admin_id = :systemAdminId,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND direction = :direction
                  AND version = :expectedVersion
                """,
                settingsParameters(
                        tenantId,
                        direction,
                        approvalRequired,
                        unitPriceRequired,
                        showCostPrice,
                        costUpdatePolicy,
                        contactRequired,
                        expectedVersion,
                        actor));
        if (updated == 0 && expectedVersion == 0) {
            updated = jdbc.update(
                    """
                    INSERT INTO inventory_manual_movement_settings (
                        tenant_id, direction, approval_required,
                        unit_price_required, show_cost_price,
                        cost_update_policy, contact_information_required,
                        version, updated_by_user_id,
                        updated_by_system_admin_id
                    ) VALUES (
                        :tenantId, :direction, :approvalRequired,
                        :unitPriceRequired, :showCostPrice,
                        :costUpdatePolicy, :contactRequired, 1,
                        :userId, :systemAdminId
                    )
                    ON CONFLICT DO NOTHING
                    """,
                    settingsParameters(
                            tenantId,
                            direction,
                            approvalRequired,
                            unitPriceRequired,
                            showCostPrice,
                            costUpdatePolicy,
                            contactRequired,
                            expectedVersion,
                            actor));
        }
        requireOne(updated);
        return settings(tenantId, direction);
    }

    public Page<MovementType> types(
            UUID tenantId,
            ManualMovementDirection direction,
            boolean includeInactive,
            Pageable pageable) {
        String where = " WHERE tenant_id = :tenantId"
                + (direction == null ? "" : " AND direction = :direction")
                + (includeInactive ? "" : " AND status = 'ACTIVE'");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue(
                        "direction",
                        direction == null ? null : direction.name())
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<MovementType> rows = jdbc.query(
                """
                SELECT id, direction, code, name, status, version
                FROM inventory_manual_movement_types
                """
                        + where
                        + " ORDER BY direction, name, id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                ManualMovementWorkflowStore::mapType);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM inventory_manual_movement_types"
                        + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows,
                pageable,
                total == null ? 0 : total);
    }

    public MovementType saveType(
            UUID tenantId,
            UUID typeId,
            ManualMovementDirection direction,
            String code,
            String name,
            String status,
            long expectedVersion,
            ManualMovementActor actor) {
        if (typeId == null) {
            UUID id = UUID.randomUUID();
            jdbc.update(
                    """
                    INSERT INTO inventory_manual_movement_types (
                        id, tenant_id, direction, code, name, status,
                        created_by_user_id, created_by_system_admin_id
                    ) VALUES (
                        :id, :tenantId, :direction, :code, :name, :status,
                        :userId, :systemAdminId
                    )
                    """,
                    typeParameters(
                            tenantId,
                            id,
                            direction,
                            code,
                            name,
                            status,
                            actor));
            return type(tenantId, id).orElseThrow();
        }
        int updated = jdbc.update(
                """
                UPDATE inventory_manual_movement_types
                SET direction = :direction,
                    code = :code,
                    name = :name,
                    status = :status,
                    version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :id
                  AND version = :expectedVersion
                """,
                typeParameters(
                                tenantId,
                                typeId,
                                direction,
                                code,
                                name,
                                status,
                                actor)
                        .addValue("expectedVersion", expectedVersion));
        requireOne(updated);
        return type(tenantId, typeId).orElseThrow();
    }

    public Optional<MovementType> type(UUID tenantId, UUID typeId) {
        return optional(
                """
                SELECT id, direction, code, name, status, version
                FROM inventory_manual_movement_types
                WHERE tenant_id = :tenantId
                  AND id = :typeId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("typeId", typeId),
                ManualMovementWorkflowStore::mapType);
    }

    public Page<BoxStock> boxStock(
            UUID tenantId,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        String search = keyword == null ? null : "%" + keyword + "%";
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseId", warehouseId)
                .addValue("keyword", search)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        String where = """
                 WHERE tenant_id = :tenantId
                   AND warehouse_id = :warehouseId
                   AND available_count > 0
                   AND reversed_at IS NULL
                """
                + (search == null
                        ? ""
                        : " AND lower(custom_box_no) LIKE :keyword");
        List<BoxStock> rows = jdbc.query(
                """
                SELECT id, warehouse_id, custom_box_no, box_number_rule,
                       length_cm, width_cm, height_cm, gross_weight_kg,
                       available_count, version
                FROM inventory_manual_box_stock
                """
                        + where
                        + " ORDER BY created_at, id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> mapBoxStock(
                        tenantId, resultSet));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM inventory_manual_box_stock"
                        + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows, pageable, total == null ? 0 : total);
    }

    public void updatePriceSnapshots(
            UUID tenantId, UUID movementId) {
        jdbc.update(
                """
                INSERT INTO inventory_manual_sku_price_snapshots (
                    tenant_id, sku_id, direction, unit_price, currency,
                    source_movement_id, source_line_id
                )
                SELECT line.tenant_id, line.sku_id, movement.direction,
                       line.unit_price, line.currency,
                       movement.id, line.id
                FROM inventory_manual_movements movement
                JOIN inventory_manual_movement_lines line
                  ON line.tenant_id = movement.tenant_id
                 AND line.movement_id = movement.id
                JOIN inventory_manual_movement_settings settings
                  ON settings.tenant_id = movement.tenant_id
                 AND settings.direction = movement.direction
                WHERE movement.tenant_id = :tenantId
                  AND movement.id = :movementId
                  AND settings.cost_update_policy = 'UPDATE_SNAPSHOT'
                  AND line.unit_price IS NOT NULL
                ON CONFLICT (tenant_id, sku_id, direction)
                DO UPDATE SET
                    unit_price = EXCLUDED.unit_price,
                    currency = EXCLUDED.currency,
                    source_movement_id = EXCLUDED.source_movement_id,
                    source_line_id = EXCLUDED.source_line_id,
                    version =
                        inventory_manual_sku_price_snapshots.version + 1,
                    recorded_at = now()
                """,
                Map.of(
                        "tenantId", tenantId,
                        "movementId", movementId));
    }

    public Optional<PriceSnapshot> priceSnapshot(
            UUID tenantId,
            UUID skuId,
            ManualMovementDirection direction) {
        return optional(
                """
                SELECT movement.warehouse_id, snapshot.unit_price,
                       snapshot.currency, snapshot.version
                FROM inventory_manual_sku_price_snapshots snapshot
                JOIN inventory_manual_movements movement
                  ON movement.tenant_id = snapshot.tenant_id
                 AND movement.id = snapshot.source_movement_id
                WHERE snapshot.tenant_id = :tenantId
                  AND snapshot.sku_id = :skuId
                  AND snapshot.direction = :direction
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("direction", direction.name()),
                (resultSet, rowNumber) -> new PriceSnapshot(
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getBigDecimal("unit_price"),
                        resultSet.getString("currency"),
                        resultSet.getLong("version")));
    }

    public void applyBoxPost(
            UUID tenantId,
            UUID movementId,
            UUID warehouseId,
            ManualMovementDirection direction) {
        List<BoxRow> boxes = movementBoxes(tenantId, movementId);
        if (direction == ManualMovementDirection.INBOUND) {
            for (BoxRow box : boxes) {
                UUID stockId = UUID.randomUUID();
                jdbc.update(
                        """
                        INSERT INTO inventory_manual_box_stock (
                            id, tenant_id, warehouse_id,
                            source_movement_id, source_movement_box_id,
                            custom_box_no, box_number_rule, length_cm,
                            width_cm, height_cm, gross_weight_kg,
                            original_count, available_count
                        ) VALUES (
                            :id, :tenantId, :warehouseId,
                            :movementId, :boxId, :customBoxNo,
                            :boxNumberRule, :lengthCm, :widthCm, :heightCm,
                            :grossWeightKg, :boxCount, :boxCount
                        )
                        """,
                        box.parameters(tenantId, movementId, warehouseId)
                                .addValue("id", stockId));
                jdbc.update(
                        """
                        INSERT INTO inventory_manual_box_stock_items (
                            id, tenant_id, box_stock_id, sku_id,
                            quantity_per_box
                        )
                        SELECT gen_random_uuid(), tenant_id, :stockId,
                               sku_id, quantity_per_box
                        FROM inventory_manual_movement_box_items
                        WHERE tenant_id = :tenantId
                          AND movement_box_id = :boxId
                        """,
                        new MapSqlParameterSource()
                                .addValue("stockId", stockId)
                                .addValue("tenantId", tenantId)
                                .addValue("boxId", box.id()));
            }
            return;
        }
        for (BoxRow box : boxes) {
            if (box.sourceBoxStockId() == null) {
                throw new IllegalStateException(
                        "Outbound boxes require source stock");
            }
            int updated = jdbc.update(
                    """
                    UPDATE inventory_manual_box_stock
                    SET available_count = available_count - :boxCount,
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId
                      AND id = :stockId
                      AND warehouse_id = :warehouseId
                      AND reversed_at IS NULL
                      AND available_count >= :boxCount
                      AND NOT EXISTS (
                          (
                              SELECT sku_id, quantity_per_box
                              FROM inventory_manual_movement_box_items
                              WHERE tenant_id = :tenantId
                                AND movement_box_id = :movementBoxId
                              EXCEPT
                              SELECT sku_id, quantity_per_box
                              FROM inventory_manual_box_stock_items
                              WHERE tenant_id = :tenantId
                                AND box_stock_id = :stockId
                          )
                          UNION ALL
                          (
                              SELECT sku_id, quantity_per_box
                              FROM inventory_manual_box_stock_items
                              WHERE tenant_id = :tenantId
                                AND box_stock_id = :stockId
                              EXCEPT
                              SELECT sku_id, quantity_per_box
                              FROM inventory_manual_movement_box_items
                              WHERE tenant_id = :tenantId
                                AND movement_box_id = :movementBoxId
                          )
                      )
                    """,
                    new MapSqlParameterSource()
                            .addValue("tenantId", tenantId)
                            .addValue(
                                    "stockId",
                                    box.sourceBoxStockId())
                            .addValue("warehouseId", warehouseId)
                            .addValue("movementBoxId", box.id())
                            .addValue("boxCount", box.boxCount()));
            requireOne(updated);
        }
    }

    public void applyBoxReverse(
            UUID tenantId,
            UUID movementId,
            ManualMovementDirection direction) {
        List<BoxRow> boxes = movementBoxes(tenantId, movementId);
        if (direction == ManualMovementDirection.INBOUND) {
            for (BoxRow box : boxes) {
                int updated = jdbc.update(
                        """
                        UPDATE inventory_manual_box_stock
                        SET available_count = 0,
                            reversed_at = now(),
                            version = version + 1,
                            updated_at = now()
                        WHERE tenant_id = :tenantId
                          AND source_movement_box_id = :boxId
                          AND reversed_at IS NULL
                          AND available_count = original_count
                        """,
                        Map.of("tenantId", tenantId, "boxId", box.id()));
                requireOne(updated);
            }
            return;
        }
        for (BoxRow box : boxes) {
            int updated = jdbc.update(
                    """
                    UPDATE inventory_manual_box_stock
                    SET available_count = available_count + :boxCount,
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId
                      AND id = :stockId
                      AND reversed_at IS NULL
                      AND available_count + :boxCount <= original_count
                    """,
                    new MapSqlParameterSource()
                            .addValue("tenantId", tenantId)
                            .addValue(
                                    "stockId",
                                    box.sourceBoxStockId())
                            .addValue("boxCount", box.boxCount()));
            requireOne(updated);
        }
    }

    private List<BoxRow> movementBoxes(
            UUID tenantId, UUID movementId) {
        return jdbc.query(
                """
                SELECT id, source_box_stock_id, custom_box_no, box_count,
                       box_number_rule, length_cm, width_cm, height_cm,
                       gross_weight_kg
                FROM inventory_manual_movement_boxes
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                ORDER BY source_box_stock_id NULLS FIRST, id
                FOR UPDATE
                """,
                Map.of("tenantId", tenantId, "movementId", movementId),
                (resultSet, rowNumber) -> new BoxRow(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getObject(
                                "source_box_stock_id",
                                UUID.class),
                        resultSet.getString("custom_box_no"),
                        resultSet.getLong("box_count"),
                        resultSet.getString("box_number_rule"),
                        resultSet.getBigDecimal("length_cm"),
                        resultSet.getBigDecimal("width_cm"),
                        resultSet.getBigDecimal("height_cm"),
                        resultSet.getBigDecimal("gross_weight_kg")));
    }

    private BoxStock mapBoxStock(
            UUID tenantId, ResultSet resultSet) throws SQLException {
        UUID stockId = resultSet.getObject("id", UUID.class);
        return new BoxStock(
                stockId,
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("custom_box_no"),
                resultSet.getString("box_number_rule"),
                resultSet.getBigDecimal("length_cm"),
                resultSet.getBigDecimal("width_cm"),
                resultSet.getBigDecimal("height_cm"),
                resultSet.getBigDecimal("gross_weight_kg"),
                resultSet.getLong("available_count"),
                resultSet.getLong("version"),
                stockItems(tenantId, stockId));
    }

    private List<BoxItem> stockItems(UUID tenantId, UUID stockId) {
        return jdbc.query(
                """
                SELECT item.sku_id, sku.business_code, sku.name,
                       item.quantity_per_box
                FROM inventory_manual_box_stock_items item
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = item.tenant_id
                 AND sku.id = item.sku_id
                WHERE item.tenant_id = :tenantId
                  AND item.box_stock_id = :stockId
                ORDER BY sku.business_code, item.sku_id
                """,
                Map.of("tenantId", tenantId, "stockId", stockId),
                (resultSet, rowNumber) -> new BoxItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("business_code"),
                        resultSet.getString("name"),
                        resultSet.getLong("quantity_per_box")));
    }

    private static Settings mapSettings(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new Settings(
                ManualMovementDirection.valueOf(
                        resultSet.getString("direction")),
                resultSet.getBoolean("approval_required"),
                resultSet.getBoolean("unit_price_required"),
                resultSet.getBoolean("show_cost_price"),
                resultSet.getString("cost_update_policy"),
                resultSet.getBoolean("contact_information_required"),
                resultSet.getLong("version"));
    }

    private static MovementType mapType(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new MovementType(
                resultSet.getObject("id", UUID.class),
                ManualMovementDirection.valueOf(
                        resultSet.getString("direction")),
                resultSet.getString("code"),
                resultSet.getString("name"),
                resultSet.getString("status"),
                resultSet.getLong("version"));
    }

    private static MapSqlParameterSource settingsParameters(
            UUID tenantId,
            ManualMovementDirection direction,
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            String costUpdatePolicy,
            boolean contactRequired,
            long expectedVersion,
            ManualMovementActor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("direction", direction.name())
                .addValue("approvalRequired", approvalRequired)
                .addValue("unitPriceRequired", unitPriceRequired)
                .addValue("showCostPrice", showCostPrice)
                .addValue("costUpdatePolicy", costUpdatePolicy)
                .addValue("contactRequired", contactRequired)
                .addValue("expectedVersion", expectedVersion)
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId());
    }

    private static MapSqlParameterSource typeParameters(
            UUID tenantId,
            UUID id,
            ManualMovementDirection direction,
            String code,
            String name,
            String status,
            ManualMovementActor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("id", id)
                .addValue("direction", direction.name())
                .addValue("code", code)
                .addValue("name", name)
                .addValue("status", status)
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId());
    }

    private <T> Optional<T> optional(
            String sql,
            MapSqlParameterSource parameters,
            RowMapper<T> mapper) {
        try {
            return Optional.ofNullable(
                    jdbc.queryForObject(sql, parameters, mapper));
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    private static void requireOne(int updated) {
        if (updated != 1) {
            throw new IllegalStateException(
                    "Manual movement changed concurrently");
        }
    }

    private static Map<String, Object> readPayload(String value) {
        return Map.copyOf(JSON.readValue(value, OBJECT_MAP));
    }

    public record ConfigurationCommand(
            String operation,
            String fingerprint,
            Map<String, Object> responsePayload) {
    }

    private record BoxRow(
            UUID id,
            UUID sourceBoxStockId,
            String customBoxNo,
            long boxCount,
            String boxNumberRule,
            java.math.BigDecimal lengthCm,
            java.math.BigDecimal widthCm,
            java.math.BigDecimal heightCm,
            java.math.BigDecimal grossWeightKg) {
        MapSqlParameterSource parameters(
                UUID tenantId,
                UUID movementId,
                UUID warehouseId) {
            return new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("movementId", movementId)
                    .addValue("warehouseId", warehouseId)
                    .addValue("boxId", id)
                    .addValue("customBoxNo", customBoxNo)
                    .addValue("boxCount", boxCount)
                    .addValue("boxNumberRule", boxNumberRule)
                    .addValue("lengthCm", lengthCm)
                    .addValue("widthCm", widthCm)
                    .addValue("heightCm", heightCm)
                    .addValue("grossWeightKg", grossWeightKg);
        }
    }
}
