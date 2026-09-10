package cn.xzkj.erp.warehouse.documents;

import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.ApprovalStatus;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Direction;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.SearchField;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Source;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Status;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class WarehouseDocumentRepository {
    private static final String DOCUMENTS = """
            WITH documents AS (
                SELECT movement.id, movement.id AS related_document_id,
                       'MANUAL_MOVEMENT'::text AS source,
                       movement.direction,
                       movement.movement_no AS document_no,
                       movement.source_reference,
                       coalesce(movement_type.name,
                           CASE movement.reason_code
                             WHEN 'FOUND_STOCK' THEN '盘盈或发现库存'
                             WHEN 'DAMAGED_STOCK' THEN '库存损坏'
                             WHEN 'LOST_STOCK' THEN '库存丢失'
                             WHEN 'RECORDING_CORRECTION' THEN '账面记录纠正'
                             ELSE '其他手工出入库'
                           END) AS document_type,
                       movement.warehouse_id,
                       warehouse.business_code AS warehouse_code,
                       warehouse.name AS warehouse_name,
                       movement.status,
                       movement.approval_status,
                       coalesce(lines.line_count, 0) AS line_count,
                       coalesce(lines.total_quantity, 0) AS total_quantity,
                       lines.total_amount,
                       lines.currency,
                       coalesce(creator.display_name, admin.display_name)
                           AS operator_display_name,
                       movement.created_at AS occurred_at,
                       movement.posted_at,
                       movement.note,
                       coalesce(lines.sku_search, '') AS sku_search,
                       coalesce(lines.location_search, '') AS location_search
                FROM inventory_manual_movements movement
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = movement.tenant_id
                 AND warehouse.id = movement.warehouse_id
                LEFT JOIN inventory_manual_movement_types movement_type
                  ON movement_type.tenant_id = movement.tenant_id
                 AND movement_type.id = movement.movement_type_id
                LEFT JOIN users creator
                  ON creator.tenant_id = movement.tenant_id
                 AND creator.id = movement.created_by_user_id
                LEFT JOIN system_admins admin
                  ON admin.id = movement.created_by_system_admin_id
                LEFT JOIN (
                    SELECT line.tenant_id, line.movement_id,
                           count(*) AS line_count,
                           sum(line.quantity) AS total_quantity,
                           CASE
                             WHEN count(*) = count(line.unit_price)
                              AND count(DISTINCT line.currency) = 1
                             THEN sum(line.quantity * line.unit_price)
                           END AS total_amount,
                           CASE
                             WHEN count(*) = count(line.unit_price)
                              AND count(DISTINCT line.currency) = 1
                             THEN max(line.currency)
                           END AS currency,
                           string_agg(lower(sku.business_code || ' ' || sku.name), ' ')
                               AS sku_search,
                           string_agg(lower(location.business_code || ' ' || location.name), ' ')
                               AS location_search
                    FROM inventory_manual_movement_lines line
                    JOIN tenant_product_skus sku
                      ON sku.tenant_id = line.tenant_id
                     AND sku.id = line.sku_id
                    JOIN tenant_warehouse_locations location
                      ON location.tenant_id = line.tenant_id
                     AND location.warehouse_id = line.warehouse_id
                     AND location.id = line.location_id
                    GROUP BY line.tenant_id, line.movement_id
                ) lines
                  ON lines.tenant_id = movement.tenant_id
                 AND lines.movement_id = movement.id
                WHERE movement.tenant_id = :tenantId

                UNION ALL

                SELECT receipt.id, receipt.purchase_order_id,
                       'PROCUREMENT_RECEIPT', 'INBOUND',
                       purchase.purchase_no,
                       purchase.plan_no_snapshot,
                       '采购签收入库',
                       purchase.warehouse_id,
                       purchase.warehouse_code_snapshot,
                       purchase.warehouse_name_snapshot,
                       'POSTED', 'NOT_REQUIRED',
                       1, receipt.quantity,
                       CAST(NULL AS numeric), CAST(NULL AS text),
                       receipt.received_by_display_name,
                       receipt.received_at, receipt.received_at,
                       purchase.order_note,
                       lower(purchase.sku_code_snapshot || ' '
                           || purchase.sku_name_snapshot),
                       lower(purchase.location_code_snapshot || ' '
                           || purchase.location_name_snapshot)
                FROM procurement_purchase_order_receipts receipt
                JOIN procurement_purchase_orders purchase
                  ON purchase.tenant_id = receipt.tenant_id
                 AND purchase.id = receipt.purchase_order_id
                WHERE receipt.tenant_id = :tenantId

                UNION ALL

                SELECT transfer.id, transfer.id,
                       'WAREHOUSE_TRANSFER', 'OUTBOUND',
                       transfer.transfer_no, NULL,
                       '分仓调拨出库',
                       transfer.source_warehouse_id,
                       warehouse.business_code, warehouse.name,
                       'POSTED', 'APPROVED',
                       shipped.line_count, shipped.total_quantity,
                       CAST(NULL AS numeric), CAST(NULL AS text),
                       transfer.shipper_display_name,
                       transfer.shipped_at, transfer.shipped_at,
                       transfer.note, shipped.sku_search, ''
                FROM inventory_warehouse_transfers transfer
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = transfer.tenant_id
                 AND warehouse.id = transfer.source_warehouse_id
                JOIN (
                    SELECT line.tenant_id, line.transfer_id,
                           count(*) AS line_count,
                           sum(line.quantity) AS total_quantity,
                           string_agg(lower(sku.business_code || ' ' || sku.name), ' ')
                               AS sku_search
                    FROM inventory_warehouse_transfer_lines line
                    JOIN tenant_product_skus sku
                      ON sku.tenant_id = line.tenant_id
                     AND sku.id = line.sku_id
                    WHERE line.shipment_event_id IS NOT NULL
                    GROUP BY line.tenant_id, line.transfer_id
                ) shipped
                  ON shipped.tenant_id = transfer.tenant_id
                 AND shipped.transfer_id = transfer.id
                WHERE transfer.tenant_id = :tenantId

                UNION ALL

                SELECT received.document_id, transfer.id,
                       'WAREHOUSE_TRANSFER', 'INBOUND',
                       transfer.transfer_no, NULL,
                       '分仓调拨入库',
                       transfer.target_warehouse_id,
                       warehouse.business_code, warehouse.name,
                       'POSTED', 'APPROVED',
                       received.line_count, received.total_quantity,
                       CAST(NULL AS numeric), CAST(NULL AS text),
                       received.receiver_display_name,
                       received.received_at, received.received_at,
                       transfer.note, received.sku_search, ''
                FROM inventory_warehouse_transfers transfer
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = transfer.tenant_id
                 AND warehouse.id = transfer.target_warehouse_id
                JOIN (
                    SELECT receipt.tenant_id, receipt.transfer_id,
                           coalesce(receipt.command_id, receipt.transfer_id)
                               AS document_id,
                           count(DISTINCT receipt.line_id) AS line_count,
                           sum(receipt.quantity) AS total_quantity,
                           max(receipt.created_at) AS received_at,
                           (array_agg(receipt.receiver_display_name
                               ORDER BY receipt.created_at DESC, receipt.id DESC))[1]
                               AS receiver_display_name,
                           string_agg(DISTINCT lower(sku.business_code || ' ' || sku.name), ' ')
                               AS sku_search
                    FROM inventory_warehouse_transfer_receipts receipt
                    JOIN inventory_warehouse_transfer_lines line
                      ON line.tenant_id = receipt.tenant_id
                     AND line.transfer_id = receipt.transfer_id
                     AND line.id = receipt.line_id
                    JOIN tenant_product_skus sku
                      ON sku.tenant_id = line.tenant_id
                     AND sku.id = line.sku_id
                    GROUP BY receipt.tenant_id, receipt.transfer_id,
                             coalesce(receipt.command_id, receipt.transfer_id)
                ) received
                  ON received.tenant_id = transfer.tenant_id
                 AND received.transfer_id = transfer.id
                WHERE transfer.tenant_id = :tenantId

                UNION ALL

                SELECT shipment.id, plan.order_id,
                       'ORDER_FULFILLMENT', 'OUTBOUND',
                       plan.external_order_ref_snapshot,
                       package.package_number,
                       '订单履约出库',
                       package.warehouse_id,
                       warehouse.business_code, warehouse.name,
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM tenant_shipment_events correction
                           WHERE correction.tenant_id = shipment.tenant_id
                             AND correction.reverses_event_id = shipment.id
                             AND correction.event_type = 'HANDOVER_CORRECTION_RECORDED'
                       ) THEN 'REVERSED' ELSE 'POSTED' END,
                       'NOT_REQUIRED',
                       inventory.line_count, inventory.total_quantity,
                       CAST(NULL AS numeric), CAST(NULL AS text),
                       coalesce(actor.display_name, '系统管理员'),
                       shipment.occurred_at, shipment.occurred_at,
                       concat_ws(' ', shipment.carrier_code,
                           shipment.service_code, shipment.tracking_reference),
                       inventory.sku_search, inventory.location_search
                FROM tenant_shipment_events shipment
                JOIN tenant_fulfillment_plans plan
                  ON plan.tenant_id = shipment.tenant_id
                 AND plan.id = shipment.plan_id
                JOIN tenant_fulfillment_packages package
                  ON package.tenant_id = shipment.tenant_id
                 AND package.id = shipment.package_id
                 AND package.plan_id = shipment.plan_id
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = package.tenant_id
                 AND warehouse.id = package.warehouse_id
                LEFT JOIN users actor
                  ON actor.tenant_id = shipment.tenant_id
                 AND actor.id = shipment.actor_user_id
                JOIN (
                    SELECT link.tenant_id, link.shipment_event_id,
                           count(DISTINCT link.fulfillment_line_id) AS line_count,
                           sum(link.quantity) AS total_quantity,
                           string_agg(DISTINCT lower(
                               line.sku_business_code_snapshot || ' '
                               || line.sku_name_snapshot), ' ') AS sku_search,
                           coalesce(string_agg(DISTINCT lower(
                               location.business_code || ' ' || location.name), ' ')
                               FILTER (WHERE location.id IS NOT NULL), '')
                               AS location_search
                    FROM tenant_shipment_inventory_events link
                    JOIN tenant_fulfillment_lines line
                      ON line.tenant_id = link.tenant_id
                     AND line.id = link.fulfillment_line_id
                    LEFT JOIN tenant_warehouse_locations location
                      ON location.tenant_id = line.tenant_id
                     AND location.id = line.location_id
                     AND location.warehouse_id = line.warehouse_id
                    WHERE link.quantity > 0
                    GROUP BY link.tenant_id, link.shipment_event_id
                ) inventory
                  ON inventory.tenant_id = shipment.tenant_id
                 AND inventory.shipment_event_id = shipment.id
                WHERE shipment.tenant_id = :tenantId
                  AND shipment.event_type = 'HANDOVER_CONFIRMED'

                UNION ALL

                SELECT count_batch.id, count_batch.id,
                       'INVENTORY_COUNT', counted.direction,
                       count_batch.count_no, CAST(NULL AS text),
                       CASE counted.direction
                         WHEN 'INBOUND' THEN '库存盘盈入库'
                         ELSE '库存盘亏出库'
                       END,
                       count_batch.warehouse_id,
                       warehouse.business_code, warehouse.name,
                       CASE
                         WHEN counted.reversed_line_count = counted.line_count
                         THEN 'REVERSED'
                         WHEN counted.reversed_line_count > 0
                         THEN 'PARTIALLY_REVERSED'
                         ELSE 'POSTED'
                       END,
                       'APPROVED',
                       counted.line_count, counted.total_quantity,
                       CAST(NULL AS numeric), CAST(NULL AS text),
                       coalesce(count_batch.approver_display_name,
                           count_batch.operator_display_name),
                       coalesce(count_batch.reviewed_at, count_batch.updated_at),
                       coalesce(count_batch.reviewed_at, count_batch.updated_at),
                       count_batch.note, counted.sku_search, ''
                FROM inventory_count_batches count_batch
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = count_batch.tenant_id
                 AND warehouse.id = count_batch.warehouse_id
                JOIN (
                    SELECT line.tenant_id, line.count_id,
                           CASE WHEN line.difference > 0
                             THEN 'INBOUND' ELSE 'OUTBOUND'
                           END AS direction,
                           count(*) AS line_count,
                           sum(abs(line.difference)) AS total_quantity,
                           count(reversal.id) AS reversed_line_count,
                           string_agg(DISTINCT lower(
                               sku.business_code || ' ' || sku.name), ' ')
                               AS sku_search
                    FROM inventory_count_lines line
                    JOIN tenant_product_skus sku
                      ON sku.tenant_id = line.tenant_id
                     AND sku.id = line.sku_id
                    LEFT JOIN inventory_ledger_events reversal
                      ON reversal.tenant_id = line.tenant_id
                     AND reversal.reversal_of_event_id = line.result_event_id
                     AND reversal.event_type = 'REVERSAL'
                    WHERE line.result_event_id IS NOT NULL
                      AND line.difference <> 0
                    GROUP BY line.tenant_id, line.count_id,
                             CASE WHEN line.difference > 0
                               THEN 'INBOUND' ELSE 'OUTBOUND'
                             END
                ) counted
                  ON counted.tenant_id = count_batch.tenant_id
                 AND counted.count_id = count_batch.id
                WHERE count_batch.tenant_id = :tenantId
                  AND count_batch.status = 'COMPLETED'
            )
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public WarehouseDocumentRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<WarehouseDocumentView> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            Direction direction,
            Source source,
            Status status,
            ApprovalStatus approvalStatus,
            SearchField searchField,
            String keyword,
            Instant occurredFrom,
            Instant occurredTo,
            Pageable pageable) {
        String where = where(
                allWarehouses, warehouseId, direction, source, status,
                approvalStatus, searchField, keyword, occurredFrom, occurredTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("direction", direction == null ? null : direction.name())
                .addValue("source", source == null ? null : source.name())
                .addValue("status", status == null ? null : status.name())
                .addValue("approvalStatus", approvalStatus == null
                        ? null : approvalStatus.name())
                .addValue("keyword", keyword)
                .addValue("occurredFrom", occurredFrom)
                .addValue("occurredTo", occurredTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<WarehouseDocumentView> rows = jdbc.query(
                DOCUMENTS + " SELECT * FROM documents " + where
                        + " ORDER BY occurred_at DESC, source, direction, id DESC"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                WarehouseDocumentRepository::map);
        Long total = jdbc.queryForObject(
                DOCUMENTS + " SELECT count(*) FROM documents " + where,
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    private static String where(
            boolean allWarehouses,
            UUID warehouseId,
            Direction direction,
            Source source,
            Status status,
            ApprovalStatus approvalStatus,
            SearchField searchField,
            String keyword,
            Instant occurredFrom,
            Instant occurredTo) {
        StringBuilder result = new StringBuilder("WHERE 1 = 1");
        if (!allWarehouses) result.append(" AND warehouse_id IN (:warehouseScope)");
        if (warehouseId != null) result.append(" AND warehouse_id = :warehouseId");
        if (direction != null) result.append(" AND direction = :direction");
        if (source != null) result.append(" AND source = :source");
        if (status != null) result.append(" AND status = :status");
        if (approvalStatus != null) {
            result.append(" AND approval_status = :approvalStatus");
        }
        if (keyword != null) {
            result.append(switch (searchField) {
                case SKU -> " AND sku_search LIKE '%' || :keyword || '%'";
                case LOCATION -> " AND location_search LIKE '%' || :keyword || '%'";
                case NOTE -> " AND lower(coalesce(note, '')) LIKE '%' || :keyword || '%'";
                case OPERATOR -> " AND lower(operator_display_name) LIKE '%' || :keyword || '%'";
                case DOCUMENT_NO -> " AND lower(document_no || ' ' || coalesce(source_reference, '')) LIKE '%' || :keyword || '%'";
            });
        }
        if (occurredFrom != null) result.append(" AND occurred_at >= :occurredFrom");
        if (occurredTo != null) result.append(" AND occurred_at <= :occurredTo");
        return result.toString();
    }

    private static WarehouseDocumentView map(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new WarehouseDocumentView(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("related_document_id", UUID.class),
                Source.valueOf(resultSet.getString("source")),
                Direction.valueOf(resultSet.getString("direction")),
                resultSet.getString("document_no"),
                resultSet.getString("source_reference"),
                resultSet.getString("document_type"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                Status.valueOf(resultSet.getString("status")),
                ApprovalStatus.valueOf(resultSet.getString("approval_status")),
                resultSet.getLong("line_count"),
                resultSet.getLong("total_quantity"),
                resultSet.getBigDecimal("total_amount"),
                resultSet.getString("currency"),
                resultSet.getString("operator_display_name"),
                instant(resultSet, "occurred_at"),
                instant(resultSet, "posted_at"));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
