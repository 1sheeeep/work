package cn.xzkj.erp.warehouse.operations.repository;

import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementTimeBucket;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementActor;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.LineInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Detail;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Box;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.BoxItem;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.ContactInformation;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Line;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.LocationOption;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.SkuOption;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Summary;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.TimelineEvent;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.WarehouseOption;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
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
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Repository
public class ManualMovementStore {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, String>> STRING_MAP =
            new TypeReference<>() {
            };
    private static final String SUMMARY_SELECT = """
            SELECT m.id, m.movement_no, m.direction, m.status,
                   m.warehouse_id, w.business_code AS warehouse_code,
                   w.name AS warehouse_name, m.movement_type_id,
                   movement_type.name AS movement_type_name,
                   m.reason_code, m.source_type, m.wms_status,
                   m.approval_status, m.entry_mode, m.note,
                   m.source_reference, m.extension_attributes::text
                       AS extension_attributes,
                   COALESCE(t.line_count, 0) AS line_count,
                   COALESCE(t.total_quantity, 0) AS total_quantity,
                   COALESCE(t.total_actual_quantity, 0)
                       AS total_actual_quantity,
                   COALESCE(t.total_amount, 0) AS total_amount,
                   t.currency,
                   m.version,
                   COALESCE(creator.display_name, creator_admin.display_name)
                       AS created_by,
                   m.reviewer_display_name AS reviewed_by,
                   m.review_note,
                   m.submitted_at, m.posted_at, m.reversed_at,
                   m.cancelled_at, m.reviewed_at,
                   m.created_at, m.updated_at
            FROM inventory_manual_movements m
            JOIN tenant_warehouses w
             ON w.tenant_id = m.tenant_id
             AND w.id = m.warehouse_id
            LEFT JOIN inventory_manual_movement_types movement_type
              ON movement_type.tenant_id = m.tenant_id
             AND movement_type.id = m.movement_type_id
            LEFT JOIN users creator
              ON creator.tenant_id = m.tenant_id
             AND creator.id = m.created_by_user_id
            LEFT JOIN system_admins creator_admin
              ON creator_admin.id = m.created_by_system_admin_id
            LEFT JOIN (
                SELECT tenant_id, movement_id,
                       count(*) AS line_count,
                       sum(quantity) AS total_quantity,
                       sum(COALESCE(actual_quantity, 0))
                           AS total_actual_quantity,
                       sum(quantity * COALESCE(unit_price, 0))
                           AS total_amount,
                       CASE
                         WHEN count(DISTINCT currency) = 1
                         THEN max(currency)
                         ELSE NULL
                       END AS currency
                FROM inventory_manual_movement_lines
                GROUP BY tenant_id, movement_id
            ) t
              ON t.tenant_id = m.tenant_id
             AND t.movement_id = m.id
            """;
    private static final String COUNT_FROM = """
            FROM inventory_manual_movements m
            LEFT JOIN users creator
              ON creator.tenant_id = m.tenant_id
             AND creator.id = m.created_by_user_id
            LEFT JOIN system_admins creator_admin
              ON creator_admin.id = m.created_by_system_admin_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ManualMovementStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<Summary> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            String keyword,
            Instant createdFrom,
            Instant createdTo,
            Pageable pageable) {
        String where = where(
                warehouseScope,
                allWarehouses,
                warehouseId,
                direction,
                status,
                reasonCode,
                movementTypeId,
                source,
                wmsStatus,
                approvalStatus,
                searchField,
                timeBucket,
                keyword,
                createdFrom,
                createdTo);
        MapSqlParameterSource parameters = parameters(
                tenantId,
                warehouseScope,
                warehouseId,
                direction,
                status,
                reasonCode,
                movementTypeId,
                source,
                wmsStatus,
                approvalStatus,
                searchField,
                timeBucket,
                keyword,
                createdFrom,
                createdTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<Summary> rows = jdbc.query(
                SUMMARY_SELECT
                        + where
                        + " ORDER BY m.created_at DESC, m.id DESC"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                ManualMovementStore::mapSummary);
        Long total = jdbc.queryForObject(
                "SELECT count(*) " + COUNT_FROM + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows,
                pageable,
                total == null ? 0 : total);
    }

    public Optional<Summary> find(
            UUID tenantId, UUID movementId, boolean forUpdate) {
        return optional(
                SUMMARY_SELECT
                        + " WHERE m.tenant_id = :tenantId AND m.id = :id"
                        + (forUpdate ? " FOR UPDATE OF m" : ""),
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", movementId),
                ManualMovementStore::mapSummary);
    }

    public Detail detail(UUID tenantId, Summary summary) {
        return new Detail(
                summary,
                lines(tenantId, summary.id()),
                boxes(tenantId, summary.id()),
                contactInformation(tenantId, summary.id()));
    }

    public ContactInformation contactInformation(
            UUID tenantId, UUID movementId) {
        return jdbc.queryForObject(
                """
                SELECT contact_name, contact_phone, contact_address
                FROM inventory_manual_movements
                WHERE tenant_id = :tenantId
                  AND id = :movementId
                """,
                Map.of("tenantId", tenantId, "movementId", movementId),
                (resultSet, rowNumber) -> new ContactInformation(
                        resultSet.getString("contact_name"),
                        resultSet.getString("contact_phone"),
                        resultSet.getString("contact_address")));
    }

    public List<Line> lines(UUID tenantId, UUID movementId) {
        return jdbc.query(
                """
                SELECT l.id, l.line_number, l.sku_id,
                       sku.business_code AS sku_code,
                       sku.name AS sku_name,
                       l.location_id,
                       location.business_code AS location_code,
                       location.name AS location_name,
                       l.quantity, l.actual_quantity, l.unit_price,
                       l.currency,
                       (l.quantity * l.unit_price) AS amount,
                       l.extension_attributes::text
                           AS extension_attributes,
                       l.note, balance.on_hand
                FROM inventory_manual_movement_lines l
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = l.tenant_id
                 AND sku.id = l.sku_id
                JOIN tenant_warehouse_locations location
                  ON location.tenant_id = l.tenant_id
                 AND location.warehouse_id = l.warehouse_id
                 AND location.id = l.location_id
                LEFT JOIN inventory_balances balance
                  ON balance.tenant_id = l.tenant_id
                 AND balance.warehouse_id = l.warehouse_id
                 AND balance.sku_id = l.sku_id
                WHERE l.tenant_id = :tenantId
                  AND l.movement_id = :movementId
                ORDER BY l.line_number, l.id
                """,
                Map.of("tenantId", tenantId, "movementId", movementId),
                ManualMovementStore::mapLine);
    }

    public List<Box> boxes(UUID tenantId, UUID movementId) {
        List<Box> rows = jdbc.query(
                """
                SELECT id, source_box_stock_id, custom_box_no, box_count,
                       box_number_rule, length_cm, width_cm, height_cm,
                       gross_weight_kg
                FROM inventory_manual_movement_boxes
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                ORDER BY line_number, id
                """,
                Map.of("tenantId", tenantId, "movementId", movementId),
                (resultSet, rowNumber) -> {
                    UUID boxId = resultSet.getObject("id", UUID.class);
                    return new Box(
                            boxId,
                            resultSet.getObject(
                                    "source_box_stock_id",
                                    UUID.class),
                            resultSet.getString("custom_box_no"),
                            resultSet.getLong("box_count"),
                            resultSet.getString("box_number_rule"),
                            resultSet.getBigDecimal("length_cm"),
                            resultSet.getBigDecimal("width_cm"),
                            resultSet.getBigDecimal("height_cm"),
                            resultSet.getBigDecimal("gross_weight_kg"),
                            boxItems(tenantId, boxId));
                });
        return List.copyOf(rows);
    }

    private List<BoxItem> boxItems(UUID tenantId, UUID boxId) {
        return jdbc.query(
                """
                SELECT item.sku_id, sku.business_code, sku.name,
                       item.quantity_per_box
                FROM inventory_manual_movement_box_items item
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = item.tenant_id
                 AND sku.id = item.sku_id
                WHERE item.tenant_id = :tenantId
                  AND item.movement_box_id = :boxId
                ORDER BY sku.business_code, item.sku_id
                """,
                Map.of("tenantId", tenantId, "boxId", boxId),
                (resultSet, rowNumber) -> new BoxItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("business_code"),
                        resultSet.getString("name"),
                        resultSet.getLong("quantity_per_box")));
    }

    public void insert(
            UUID movementId,
            UUID tenantId,
            String movementNo,
            UUID warehouseId,
            ManualMovementDirection direction,
            UUID movementTypeId,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            String contactName,
            String contactPhone,
            String contactAddress,
            Map<String, String> extensionAttributes,
            ManualMovementActor actor) {
        jdbc.update(
                """
                INSERT INTO inventory_manual_movements (
                    id, tenant_id, movement_no, direction, warehouse_id,
                    movement_type_id, reason_code, source_type, entry_mode,
                    note, source_reference, contact_name, contact_phone,
                    contact_address, extension_attributes,
                    created_by_user_id, created_by_system_admin_id
                ) VALUES (
                    :id, :tenantId, :movementNo, :direction, :warehouseId,
                    :movementTypeId, :reasonCode, :source, :entryMode,
                    :note, :sourceReference, :contactName, :contactPhone,
                    :contactAddress, CAST(:extensions AS jsonb),
                    :userId, :systemAdminId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", movementId)
                        .addValue("tenantId", tenantId)
                        .addValue("movementNo", movementNo)
                        .addValue("direction", direction.name())
                        .addValue("warehouseId", warehouseId)
                        .addValue("movementTypeId", movementTypeId)
                        .addValue("reasonCode", reasonCode.name())
                        .addValue("source", source.name())
                        .addValue("entryMode", entryMode.name())
                        .addValue("note", note)
                        .addValue("sourceReference", sourceReference)
                        .addValue("contactName", contactName)
                        .addValue("contactPhone", contactPhone)
                        .addValue("contactAddress", contactAddress)
                        .addValue(
                                "extensions",
                                json(extensionAttributes))
                        .addValue("userId", actor.userId())
                        .addValue("systemAdminId", actor.systemAdminId()));
    }

    public void updateDraft(
            UUID tenantId,
            UUID movementId,
            long expectedVersion,
            UUID warehouseId,
            ManualMovementDirection direction,
            UUID movementTypeId,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            String contactName,
            String contactPhone,
            String contactAddress,
            Map<String, String> extensionAttributes) {
        int updated = jdbc.update(
                """
                UPDATE inventory_manual_movements
                SET warehouse_id = :warehouseId,
                    direction = :direction,
                    movement_type_id = :movementTypeId,
                    reason_code = :reasonCode,
                    source_type = :source,
                    entry_mode = :entryMode,
                    note = :note,
                    source_reference = :sourceReference,
                    contact_name = :contactName,
                    contact_phone = :contactPhone,
                    contact_address = :contactAddress,
                    extension_attributes = CAST(:extensions AS jsonb),
                    version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :id
                  AND version = :expectedVersion
                  AND status = 'DRAFT'
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", movementId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("warehouseId", warehouseId)
                        .addValue("direction", direction.name())
                        .addValue("movementTypeId", movementTypeId)
                        .addValue("reasonCode", reasonCode.name())
                        .addValue("source", source.name())
                        .addValue("entryMode", entryMode.name())
                        .addValue("note", note)
                        .addValue("sourceReference", sourceReference)
                        .addValue("contactName", contactName)
                        .addValue("contactPhone", contactPhone)
                        .addValue("contactAddress", contactAddress)
                        .addValue(
                                "extensions",
                                json(extensionAttributes)));
        requireOne(updated);
    }

    public void replaceLines(
            UUID tenantId,
            UUID movementId,
            UUID warehouseId,
            List<LineInput> lines) {
        jdbc.update(
                """
                DELETE FROM inventory_manual_movement_lines
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                """,
                Map.of("tenantId", tenantId, "movementId", movementId));
        for (int index = 0; index < lines.size(); index++) {
            LineInput line = lines.get(index);
            jdbc.update(
                    """
                    INSERT INTO inventory_manual_movement_lines (
                        id, tenant_id, movement_id, warehouse_id,
                        line_number, sku_id, location_id, quantity,
                        unit_price, currency, extension_attributes, note
                    ) VALUES (
                        :id, :tenantId, :movementId, :warehouseId,
                        :lineNumber, :skuId, :locationId, :quantity,
                        :unitPrice, :currency,
                        CAST(:extensions AS jsonb), :note
                    )
                    """,
                    new MapSqlParameterSource()
                            .addValue("id", UUID.randomUUID())
                            .addValue("tenantId", tenantId)
                            .addValue("movementId", movementId)
                            .addValue("warehouseId", warehouseId)
                            .addValue("lineNumber", index + 1)
                            .addValue("skuId", line.skuId())
                            .addValue("locationId", line.locationId())
                            .addValue("quantity", line.quantity())
                            .addValue("unitPrice", line.unitPrice())
                            .addValue("currency", line.currency())
                            .addValue(
                                    "extensions",
                                    json(line.extensionAttributes()))
                            .addValue("note", line.note()));
        }
    }

    public void replaceBoxes(
            UUID tenantId,
            UUID movementId,
            UUID warehouseId,
            List<ManualMovementCommands.BoxInput> boxes) {
        jdbc.update(
                """
                DELETE FROM inventory_manual_movement_boxes
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                """,
                Map.of("tenantId", tenantId, "movementId", movementId));
        for (int index = 0; index < boxes.size(); index++) {
            ManualMovementCommands.BoxInput box = boxes.get(index);
            UUID boxId = UUID.randomUUID();
            jdbc.update(
                    """
                    INSERT INTO inventory_manual_movement_boxes (
                        id, tenant_id, movement_id, warehouse_id,
                        line_number, source_box_stock_id, custom_box_no,
                        box_count, box_number_rule, length_cm, width_cm,
                        height_cm, gross_weight_kg
                    ) VALUES (
                        :id, :tenantId, :movementId, :warehouseId,
                        :lineNumber, :sourceBoxStockId, :customBoxNo,
                        :boxCount, :boxNumberRule, :lengthCm, :widthCm,
                        :heightCm, :grossWeightKg
                    )
                    """,
                    new MapSqlParameterSource()
                            .addValue("id", boxId)
                            .addValue("tenantId", tenantId)
                            .addValue("movementId", movementId)
                            .addValue("warehouseId", warehouseId)
                            .addValue("lineNumber", index + 1)
                            .addValue(
                                    "sourceBoxStockId",
                                    box.sourceBoxStockId())
                            .addValue("customBoxNo", box.customBoxNo())
                            .addValue("boxCount", box.boxCount())
                            .addValue(
                                    "boxNumberRule",
                                    box.boxNumberRule())
                            .addValue("lengthCm", box.lengthCm())
                            .addValue("widthCm", box.widthCm())
                            .addValue("heightCm", box.heightCm())
                            .addValue(
                                    "grossWeightKg",
                                    box.grossWeightKg()));
            for (ManualMovementCommands.BoxItemInput item : box.items()) {
                jdbc.update(
                        """
                        INSERT INTO inventory_manual_movement_box_items (
                            id, tenant_id, movement_box_id, sku_id,
                            quantity_per_box
                        ) VALUES (
                            :id, :tenantId, :boxId, :skuId,
                            :quantityPerBox
                        )
                        """,
                        new MapSqlParameterSource()
                                .addValue("id", UUID.randomUUID())
                                .addValue("tenantId", tenantId)
                                .addValue("boxId", boxId)
                                .addValue("skuId", item.skuId())
                                .addValue(
                                        "quantityPerBox",
                                        item.quantityPerBox()));
            }
        }
    }

    public void transition(
            UUID tenantId,
            UUID movementId,
            long expectedVersion,
            ManualMovementStatus from,
            ManualMovementStatus to) {
        String timestamp = switch (to) {
            case SUBMITTED -> "submitted_at = now(),";
            case POSTED -> "posted_at = now(),";
            case REVERSED -> "reversed_at = now(),";
            case CANCELLED -> "cancelled_at = now(),";
            case DRAFT -> "submitted_at = NULL,";
        };
        int updated = jdbc.update(
                "UPDATE inventory_manual_movements"
                        + " SET status = :to,"
                        + timestamp
                        + " version = version + 1, updated_at = now()"
                        + " WHERE tenant_id = :tenantId"
                        + " AND id = :id"
                        + " AND version = :expectedVersion"
                        + " AND status = :from",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", movementId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("from", from.name())
                        .addValue("to", to.name()));
        requireOne(updated);
    }

    public void updateApproval(
            UUID tenantId,
            UUID movementId,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementActor reviewer,
            String reviewNote) {
        jdbc.update(
                """
                UPDATE inventory_manual_movements
                SET approval_status = :approvalStatus,
                    reviewed_at = CASE
                        WHEN :approvalStatus IN ('APPROVED', 'REJECTED')
                        THEN now()
                        ELSE NULL
                    END,
                    reviewed_by_user_id = CASE
                        WHEN :approvalStatus IN ('APPROVED', 'REJECTED')
                        THEN CAST(:userId AS UUID)
                        ELSE CAST(NULL AS UUID)
                    END,
                    reviewed_by_system_admin_id = CASE
                        WHEN :approvalStatus IN ('APPROVED', 'REJECTED')
                        THEN CAST(:systemAdminId AS UUID)
                        ELSE CAST(NULL AS UUID)
                    END,
                    reviewer_display_name = CASE
                        WHEN :approvalStatus IN ('APPROVED', 'REJECTED')
                        THEN :displayName
                        ELSE NULL
                    END,
                    review_note = CASE
                        WHEN :approvalStatus IN ('APPROVED', 'REJECTED')
                        THEN :reviewNote
                        ELSE NULL
                    END,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :movementId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("movementId", movementId)
                        .addValue(
                                "approvalStatus",
                                approvalStatus.name())
                        .addValue("userId", reviewer.userId())
                        .addValue(
                                "systemAdminId",
                                reviewer.systemAdminId())
                        .addValue(
                                "displayName",
                                reviewer.displayName())
                        .addValue("reviewNote", reviewNote));
    }

    public void markActualQuantities(
            UUID tenantId, UUID movementId) {
        jdbc.update(
                """
                UPDATE inventory_manual_movement_lines
                SET actual_quantity = quantity
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                """,
                Map.of("tenantId", tenantId, "movementId", movementId));
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        String value = "manual-movement:" + tenantId + ":" + commandId;
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", value),
                Object.class);
    }

    public Optional<CommandRecord> findCommand(
            UUID tenantId, UUID commandId) {
        return optional(
                """
                SELECT movement_id, operation, request_fingerprint,
                       result_status, result_version
                FROM inventory_manual_movement_commands
                WHERE tenant_id = :tenantId
                  AND command_id = :commandId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId),
                (resultSet, rowNumber) -> new CommandRecord(
                        resultSet.getObject("movement_id", UUID.class),
                        resultSet.getString("operation"),
                        resultSet.getString("request_fingerprint"),
                        ManualMovementStatus.valueOf(
                                resultSet.getString("result_status")),
                        resultSet.getLong("result_version")));
    }

    public void insertCommand(
            UUID tenantId,
            UUID commandId,
            UUID movementId,
            String operation,
            String fingerprint,
            ManualMovementStatus resultStatus,
            long resultVersion) {
        jdbc.update(
                """
                INSERT INTO inventory_manual_movement_commands (
                    tenant_id, command_id, movement_id, operation,
                    request_fingerprint, result_status, result_version
                ) VALUES (
                    :tenantId, :commandId, :movementId, :operation,
                    :fingerprint, :resultStatus, :resultVersion
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("movementId", movementId)
                        .addValue("operation", operation)
                        .addValue("fingerprint", fingerprint)
                        .addValue("resultStatus", resultStatus.name())
                        .addValue("resultVersion", resultVersion));
    }

    public void insertTimelineEvent(
            UUID tenantId,
            UUID movementId,
            String eventType,
            ManualMovementStatus fromStatus,
            ManualMovementStatus toStatus,
            long version,
            UUID commandId,
            ManualMovementActor actor) {
        jdbc.update(
                """
                INSERT INTO inventory_manual_movement_events (
                    id, tenant_id, movement_id, event_type,
                    from_status, to_status, movement_version,
                    command_id, actor_user_id, actor_system_admin_id,
                    request_id
                ) VALUES (
                    :id, :tenantId, :movementId, :eventType,
                    :fromStatus, :toStatus, :version,
                    :commandId, :userId, :systemAdminId,
                    :requestId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID())
                        .addValue("tenantId", tenantId)
                        .addValue("movementId", movementId)
                        .addValue("eventType", eventType)
                        .addValue(
                                "fromStatus",
                                fromStatus == null ? null : fromStatus.name())
                        .addValue("toStatus", toStatus.name())
                        .addValue("version", version)
                        .addValue("commandId", commandId)
                        .addValue("userId", actor.userId())
                        .addValue("systemAdminId", actor.systemAdminId())
                        .addValue("requestId", actor.requestId()));
    }

    public List<TimelineEvent> timeline(
            UUID tenantId, UUID movementId) {
        return jdbc.query(
                """
                SELECT id, event_type, from_status, to_status,
                       movement_version, request_id, recorded_at
                FROM inventory_manual_movement_events
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                ORDER BY recorded_at, id
                """,
                Map.of("tenantId", tenantId, "movementId", movementId),
                ManualMovementStore::mapTimeline);
    }

    public Optional<String> lockWarehouseStatus(
            UUID tenantId, UUID warehouseId) {
        return optional(
                """
                SELECT status
                FROM tenant_warehouses
                WHERE tenant_id = :tenantId
                  AND id = :warehouseId
                FOR UPDATE
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseId", warehouseId),
                (resultSet, rowNumber) -> resultSet.getString("status"));
    }

    public Optional<String> lockSkuStatus(UUID tenantId, UUID skuId) {
        return optional(
                """
                SELECT status
                FROM tenant_product_skus
                WHERE tenant_id = :tenantId
                  AND id = :skuId
                FOR UPDATE
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId),
                (resultSet, rowNumber) -> resultSet.getString("status"));
    }

    public Optional<String> lockLocationStatus(
            UUID tenantId, UUID warehouseId, UUID locationId) {
        return optional(
                """
                SELECT status
                FROM tenant_warehouse_locations
                WHERE tenant_id = :tenantId
                  AND warehouse_id = :warehouseId
                  AND id = :locationId
                FOR UPDATE
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("locationId", locationId),
                (resultSet, rowNumber) -> resultSet.getString("status"));
    }

    public boolean hasOpenForWarehouse(
            UUID tenantId, UUID warehouseId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM inventory_manual_movements
                    WHERE tenant_id = :tenantId
                      AND warehouse_id = :warehouseId
                      AND status = 'DRAFT'
                )
                """,
                Map.of("tenantId", tenantId, "warehouseId", warehouseId),
                Boolean.class));
    }

    public boolean hasOpenForLocation(
            UUID tenantId, UUID warehouseId, UUID locationId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM inventory_manual_movement_lines l
                    JOIN inventory_manual_movements m
                      ON m.tenant_id = l.tenant_id
                     AND m.id = l.movement_id
                    WHERE l.tenant_id = :tenantId
                      AND l.warehouse_id = :warehouseId
                      AND l.location_id = :locationId
                      AND m.status = 'DRAFT'
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("locationId", locationId),
                Boolean.class));
    }

    public Page<WarehouseOption> warehouseOptions(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String keyword,
            Pageable pageable) {
        String scopeClause = allWarehouses
                ? ""
                : " AND id IN (:warehouseScope)";
        String keywordClause = keyword == null
                ? ""
                : " AND (lower(business_code) LIKE :keyword"
                        + " OR lower(name) LIKE :keyword)";
        MapSqlParameterSource parameters =
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseScope", warehouseScope)
                        .addValue(
                                "keyword",
                                keyword == null ? null : "%" + keyword + "%")
                        .addValue("limit", pageable.getPageSize())
                        .addValue("offset", pageable.getOffset());
        String where = " WHERE tenant_id = :tenantId"
                + " AND status = 'ACTIVE'"
                + scopeClause
                + keywordClause;
        List<WarehouseOption> rows = jdbc.query(
                "SELECT id, business_code, name"
                        + " FROM tenant_warehouses"
                        + where
                        + " ORDER BY business_code, id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new WarehouseOption(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("business_code"),
                        resultSet.getString("name")));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM tenant_warehouses" + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows, pageable, total == null ? 0 : total);
    }

    public Page<LocationOption> locationOptions(
            UUID tenantId,
            UUID warehouseId,
            String keyword,
            Pageable pageable) {
        String keywordClause = keyword == null
                ? ""
                : " AND (lower(business_code) LIKE :keyword"
                        + " OR lower(name) LIKE :keyword)";
        String where = " WHERE tenant_id = :tenantId"
                + " AND warehouse_id = :warehouseId"
                + " AND status = 'ACTIVE'"
                + keywordClause;
        MapSqlParameterSource parameters =
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseId", warehouseId)
                        .addValue(
                                "keyword",
                                keyword == null ? null : "%" + keyword + "%")
                        .addValue("limit", pageable.getPageSize())
                        .addValue("offset", pageable.getOffset());
        List<LocationOption> rows = jdbc.query(
                "SELECT id, warehouse_id, business_code, name"
                        + " FROM tenant_warehouse_locations"
                        + where
                        + " ORDER BY business_code, id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new LocationOption(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("business_code"),
                        resultSet.getString("name")));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM tenant_warehouse_locations" + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows, pageable, total == null ? 0 : total);
    }

    public Page<SkuOption> skuOptions(
            UUID tenantId,
            String keyword,
            Pageable pageable) {
        String keywordClause = keyword == null
                ? ""
                : " AND (lower(business_code) LIKE :keyword"
                        + " OR lower(name) LIKE :keyword"
                        + " OR lower(COALESCE(variant_summary, ''))"
                        + " LIKE :keyword)";
        String where = " WHERE tenant_id = :tenantId"
                + " AND status = 'ACTIVE'"
                + keywordClause;
        MapSqlParameterSource parameters =
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue(
                                "keyword",
                                keyword == null ? null : "%" + keyword + "%")
                        .addValue("limit", pageable.getPageSize())
                        .addValue("offset", pageable.getOffset());
        List<SkuOption> rows = jdbc.query(
                "SELECT id, business_code, name, variant_summary"
                        + " FROM tenant_product_skus"
                        + where
                        + " ORDER BY business_code, id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new SkuOption(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("business_code"),
                        resultSet.getString("name"),
                        resultSet.getString("variant_summary")));
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM tenant_product_skus" + where,
                parameters,
                Long.class);
        return new PageImpl<>(
                rows, pageable, total == null ? 0 : total);
    }

    private static String where(
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        StringBuilder where =
                new StringBuilder(" WHERE m.tenant_id = :tenantId");
        if (!allWarehouses) {
            where.append(" AND m.warehouse_id IN (:warehouseScope)");
        }
        if (warehouseId != null) {
            where.append(" AND m.warehouse_id = :warehouseId");
        }
        if (direction != null) {
            where.append(" AND m.direction = :direction");
        }
        if (status != null) {
            where.append(" AND m.status = :status");
        }
        if (reasonCode != null) {
            where.append(" AND m.reason_code = :reasonCode");
        }
        if (movementTypeId != null) {
            where.append(" AND m.movement_type_id = :movementTypeId");
        }
        if (source != null) {
            where.append(" AND m.source_type = :source");
        }
        if (wmsStatus != null) {
            where.append(" AND m.wms_status = :wmsStatus");
        }
        if (approvalStatus != null) {
            where.append(" AND m.approval_status = :approvalStatus");
        }
        if (timeBucket == ManualMovementTimeBucket.RECENT_THREE_MONTHS) {
            where.append(" AND m.created_at >= now() - interval '3 months'");
        } else if (timeBucket
                == ManualMovementTimeBucket.OLDER_THAN_THREE_MONTHS) {
            where.append(" AND m.created_at < now() - interval '3 months'");
        }
        if (keyword != null) {
            where.append(keywordClause(searchField));
        }
        if (createdFrom != null) {
            where.append(" AND m.created_at >= :createdFrom");
        }
        if (createdTo != null) {
            where.append(" AND m.created_at <= :createdTo");
        }
        return where.toString();
    }

    private static String keywordClause(
            ManualMovementSearchField searchField) {
        if (searchField == ManualMovementSearchField.BATCH_NO) {
            return """
                     AND (
                       lower(m.movement_no) LIKE :keyword
                       OR lower(COALESCE(m.source_reference, ''))
                          LIKE :keyword
                     )
                    """;
        }
        if (searchField == ManualMovementSearchField.NOTE) {
            return " AND lower(COALESCE(m.note, '')) LIKE :keyword";
        }
        if (searchField == ManualMovementSearchField.OPERATOR) {
            return """
                     AND lower(COALESCE(
                       creator.display_name,
                       creator_admin.display_name,
                       ''
                     )) LIKE :keyword
                    """;
        }
        if (searchField == ManualMovementSearchField.SKU) {
            return """
                     AND EXISTS (
                       SELECT 1
                       FROM inventory_manual_movement_lines search_line
                       JOIN tenant_product_skus search_sku
                         ON search_sku.tenant_id = search_line.tenant_id
                        AND search_sku.id = search_line.sku_id
                       WHERE search_line.tenant_id = m.tenant_id
                         AND search_line.movement_id = m.id
                         AND (
                           lower(search_sku.business_code) LIKE :keyword
                           OR lower(search_sku.name) LIKE :keyword
                         )
                     )
                    """;
        }
        if (searchField == ManualMovementSearchField.LOCATION) {
            return """
                     AND EXISTS (
                       SELECT 1
                       FROM inventory_manual_movement_lines search_line
                       JOIN tenant_warehouse_locations search_location
                         ON search_location.tenant_id = search_line.tenant_id
                        AND search_location.warehouse_id =
                            search_line.warehouse_id
                        AND search_location.id = search_line.location_id
                       WHERE search_line.tenant_id = m.tenant_id
                         AND search_line.movement_id = m.id
                         AND lower(search_location.business_code)
                             LIKE :keyword
                     )
                    """;
        }
        return """
                     AND (
                       lower(m.movement_no) LIKE :keyword
                       OR lower(COALESCE(m.note, '')) LIKE :keyword
                       OR lower(COALESCE(m.source_reference, '')) LIKE :keyword
                       OR EXISTS (
                         SELECT 1
                         FROM inventory_manual_movement_lines search_line
                         JOIN tenant_product_skus search_sku
                           ON search_sku.tenant_id = search_line.tenant_id
                          AND search_sku.id = search_line.sku_id
                         JOIN tenant_warehouse_locations search_location
                           ON search_location.tenant_id = search_line.tenant_id
                          AND search_location.warehouse_id =
                              search_line.warehouse_id
                          AND search_location.id = search_line.location_id
                         WHERE search_line.tenant_id = m.tenant_id
                           AND search_line.movement_id = m.id
                           AND (
                             lower(search_sku.business_code) LIKE :keyword
                             OR lower(search_sku.name) LIKE :keyword
                             OR lower(search_location.business_code)
                                LIKE :keyword
                           )
                       )
                     )
                    """;
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId,
            Set<UUID> warehouseScope,
            UUID warehouseId,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            ManualMovementReasonCode reasonCode,
            UUID movementTypeId,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementSearchField searchField,
            ManualMovementTimeBucket timeBucket,
            String keyword,
            Instant createdFrom,
            Instant createdTo) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue(
                        "direction",
                        direction == null ? null : direction.name())
                .addValue("status", status == null ? null : status.name())
                .addValue(
                        "reasonCode",
                        reasonCode == null ? null : reasonCode.name())
                .addValue("movementTypeId", movementTypeId)
                .addValue(
                        "source",
                        source == null ? null : source.name())
                .addValue(
                        "wmsStatus",
                        wmsStatus == null ? null : wmsStatus.name())
                .addValue(
                        "approvalStatus",
                        approvalStatus == null
                                ? null
                                : approvalStatus.name())
                .addValue(
                        "keyword",
                        keyword == null ? null : "%" + keyword + "%")
                .addValue("createdFrom", createdFrom)
                .addValue("createdTo", createdTo);
    }

    private static Summary mapSummary(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new Summary(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("movement_no"),
                ManualMovementDirection.valueOf(
                        resultSet.getString("direction")),
                ManualMovementStatus.valueOf(
                        resultSet.getString("status")),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                resultSet.getObject("movement_type_id", UUID.class),
                resultSet.getString("movement_type_name"),
                ManualMovementReasonCode.valueOf(
                        resultSet.getString("reason_code")),
                ManualMovementSource.valueOf(
                        resultSet.getString("source_type")),
                ManualMovementWmsStatus.valueOf(
                        resultSet.getString("wms_status")),
                ManualMovementApprovalStatus.valueOf(
                        resultSet.getString("approval_status")),
                ManualMovementEntryMode.valueOf(
                        resultSet.getString("entry_mode")),
                resultSet.getString("note"),
                resultSet.getString("source_reference"),
                stringMap(resultSet.getString("extension_attributes")),
                resultSet.getInt("line_count"),
                resultSet.getLong("total_quantity"),
                resultSet.getLong("total_actual_quantity"),
                resultSet.getBigDecimal("total_amount"),
                resultSet.getString("currency"),
                resultSet.getLong("version"),
                resultSet.getString("created_by"),
                resultSet.getString("reviewed_by"),
                resultSet.getString("review_note"),
                instant(resultSet, "submitted_at"),
                instant(resultSet, "posted_at"),
                instant(resultSet, "reversed_at"),
                instant(resultSet, "cancelled_at"),
                instant(resultSet, "reviewed_at"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"));
    }

    private static Line mapLine(
            ResultSet resultSet, int rowNumber) throws SQLException {
        Long onHand = nullableLong(resultSet, "on_hand");
        return new Line(
                resultSet.getObject("id", UUID.class),
                resultSet.getInt("line_number"),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getObject("location_id", UUID.class),
                resultSet.getString("location_code"),
                resultSet.getString("location_name"),
                resultSet.getLong("quantity"),
                nullableLong(resultSet, "actual_quantity"),
                resultSet.getBigDecimal("unit_price"),
                resultSet.getString("currency"),
                resultSet.getBigDecimal("amount"),
                stringMap(resultSet.getString("extension_attributes")),
                resultSet.getString("note"),
                onHand,
                onHand);
    }

    private static TimelineEvent mapTimeline(
            ResultSet resultSet, int rowNumber) throws SQLException {
        String from = resultSet.getString("from_status");
        return new TimelineEvent(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("event_type"),
                from == null ? null : ManualMovementStatus.valueOf(from),
                ManualMovementStatus.valueOf(
                        resultSet.getString("to_status")),
                resultSet.getLong("movement_version"),
                resultSet.getString("request_id"),
                instant(resultSet, "recorded_at"));
    }

    private static Instant instant(
            ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value =
                resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static Long nullableLong(
            ResultSet resultSet, String column) throws SQLException {
        long value = resultSet.getLong(column);
        return resultSet.wasNull() ? null : value;
    }

    private static String json(Map<String, String> value) {
        try {
            return JSON.writeValueAsString(
                    value == null ? Map.of() : value);
        } catch (JacksonException exception) {
            throw new IllegalArgumentException(
                    "Invalid extension attributes", exception);
        }
    }

    private static Map<String, String> stringMap(String value) {
        if (value == null || value.isBlank()) {
            return Map.of();
        }
        try {
            return Map.copyOf(JSON.readValue(value, STRING_MAP));
        } catch (JacksonException exception) {
            throw new IllegalStateException(
                    "Invalid stored extension attributes", exception);
        }
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

    public record CommandRecord(
            UUID movementId,
            String operation,
            String fingerprint,
            ManualMovementStatus resultStatus,
            long resultVersion) {
    }
}
