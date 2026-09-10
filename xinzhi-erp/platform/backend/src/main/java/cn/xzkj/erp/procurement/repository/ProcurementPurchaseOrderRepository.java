package cn.xzkj.erp.procurement.repository;

import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.service.ProcurementReceiptView;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import cn.xzkj.erp.procurement.service.ProcurementSupplierOption;
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
public class ProcurementPurchaseOrderRepository {
    private static final String ORDER_SELECT = """
            SELECT purchase_order.id, purchase_order.purchase_no,
                   purchase_order.status, purchase_order.plan_id,
                   purchase_order.plan_no_snapshot, purchase_order.supplier_id,
                   purchase_order.supplier_code_snapshot,
                   purchase_order.supplier_name_snapshot,
                   purchase_order.supplier_sku_code_snapshot,
                   purchase_order.sku_id, purchase_order.sku_code_snapshot,
                   purchase_order.sku_name_snapshot,
                   purchase_order.sku_variant_snapshot,
                   purchase_order.warehouse_id,
                   purchase_order.warehouse_code_snapshot,
                   purchase_order.warehouse_name_snapshot,
                   purchase_order.location_id,
                   purchase_order.location_code_snapshot,
                   purchase_order.location_name_snapshot,
                   purchase_order.quantity, purchase_order.received_quantity,
                   purchase_order.order_note,
                   purchase_order.ordered_by_display_name,
                   purchase_order.review_decision,
                   purchase_order.review_note,
                   purchase_order.reviewed_by_display_name,
                   purchase_order.reviewed_at,
                   purchase_order.version, purchase_order.last_received_at,
                   purchase_order.created_at,
                   purchase_order.updated_at
            FROM procurement_purchase_orders purchase_order
            """;
    private static final String RECEIPT_SELECT = """
            SELECT receipt.id, receipt.purchase_order_id,
                   purchase_order.purchase_no,
                   purchase_order.plan_no_snapshot,
                   purchase_order.supplier_id,
                   purchase_order.supplier_code_snapshot,
                   purchase_order.supplier_name_snapshot,
                   purchase_order.sku_id,
                   purchase_order.sku_code_snapshot,
                   purchase_order.sku_name_snapshot,
                   purchase_order.sku_variant_snapshot,
                   purchase_order.warehouse_id,
                   purchase_order.warehouse_code_snapshot,
                   purchase_order.warehouse_name_snapshot,
                   purchase_order.location_id,
                   purchase_order.location_code_snapshot,
                   purchase_order.location_name_snapshot,
                   receipt.quantity, receipt.inventory_event_id,
                   inventory_event.ledger_sequence,
                   inventory_event.balance_after,
                   receipt.received_by_display_name,
                   receipt.received_at
            FROM procurement_purchase_order_receipts receipt
            JOIN procurement_purchase_orders purchase_order
              ON purchase_order.tenant_id = receipt.tenant_id
             AND purchase_order.id = receipt.purchase_order_id
            JOIN inventory_ledger_events inventory_event
              ON inventory_event.tenant_id = receipt.tenant_id
             AND inventory_event.id = receipt.inventory_event_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ProcurementPurchaseOrderRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<ProcurementPurchaseOrderView> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID supplierId,
            ProcurementPurchaseOrderStatus status,
            boolean receivableOnly,
            ProcurementPurchaseOrderSearchField searchField,
            String keyword,
            Instant createdFrom,
            Instant createdTo,
            Pageable pageable) {
        String where = where(
                allWarehouses, warehouseId, supplierId, status,
                receivableOnly, searchField,
                keyword, createdFrom, createdTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("supplierId", supplierId)
                .addValue("status", status == null ? null : status.name())
                .addValue("keyword", keyword)
                .addValue("createdFrom", createdFrom)
                .addValue("createdTo", createdTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementPurchaseOrderView> rows = jdbc.query(
                ORDER_SELECT + where
                        + " ORDER BY purchase_order.created_at DESC, purchase_order.id DESC"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                ProcurementPurchaseOrderRepository::mapOrder);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_purchase_orders purchase_order" + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<ProcurementPurchaseOrderView> find(
            UUID tenantId, UUID purchaseOrderId) {
        return optionalQuery(
                ORDER_SELECT
                        + " WHERE purchase_order.tenant_id = :tenantId"
                        + " AND purchase_order.id = :purchaseOrderId",
                Map.of("tenantId", tenantId, "purchaseOrderId", purchaseOrderId),
                ProcurementPurchaseOrderRepository::mapOrder);
    }

    public Optional<ProcurementPurchaseOrderView> lock(
            UUID tenantId, UUID purchaseOrderId) {
        return optionalQuery(
                ORDER_SELECT
                        + " WHERE purchase_order.tenant_id = :tenantId"
                        + " AND purchase_order.id = :purchaseOrderId"
                        + " FOR UPDATE OF purchase_order",
                Map.of("tenantId", tenantId, "purchaseOrderId", purchaseOrderId),
                ProcurementPurchaseOrderRepository::mapOrder);
    }

    public Page<ProcurementReceiptView> listReceipts(
            UUID tenantId, Set<UUID> warehouseScope, boolean allWarehouses,
            UUID purchaseOrderId, String supplierKeyword,
            String purchaseKeyword,
            Instant receivedFrom, Instant receivedTo,
            ProcurementReceiptSort sort, Pageable pageable) {
        String where = receiptWhere(
                allWarehouses, purchaseOrderId, supplierKeyword,
                purchaseKeyword,
                receivedFrom, receivedTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("purchaseOrderId", purchaseOrderId)
                .addValue("supplierKeyword", supplierKeyword)
                .addValue("purchaseKeyword", purchaseKeyword)
                .addValue("receivedFrom", receivedFrom)
                .addValue("receivedTo", receivedTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementReceiptView> rows = jdbc.query(
                RECEIPT_SELECT + where + receiptOrder(sort)
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                ProcurementPurchaseOrderRepository::mapReceipt);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_purchase_order_receipts receipt"
                        + " JOIN procurement_purchase_orders purchase_order"
                        + " ON purchase_order.tenant_id = receipt.tenant_id"
                        + " AND purchase_order.id = receipt.purchase_order_id"
                        + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Page<ProcurementSupplierOption> listSupplierOptions(
            UUID tenantId, UUID planId, String keyword, Pageable pageable) {
        String filter = keyword == null ? "" : """
                 AND (lower(supplier.business_code) LIKE '%' || :keyword || '%'
                   OR lower(supplier.name) LIKE '%' || :keyword || '%'
                   OR lower(coalesce(mapping.supplier_sku_code, '')) LIKE '%' || :keyword || '%')
                """;
        String from = """
                FROM procurement_plans plan
                JOIN tenant_supplier_sku_mappings mapping
                  ON mapping.tenant_id = plan.tenant_id
                 AND mapping.sku_id = plan.sku_id
                 AND mapping.status = 'ACTIVE'
                JOIN tenant_suppliers supplier
                  ON supplier.tenant_id = mapping.tenant_id
                 AND supplier.id = mapping.supplier_id
                 AND supplier.status = 'ACTIVE'
                WHERE plan.tenant_id = :tenantId AND plan.id = :planId
                  AND plan.status = 'UNPURCHASED'
                """ + filter;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("planId", planId)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementSupplierOption> rows = jdbc.query(
                "SELECT supplier.id, supplier.business_code, supplier.name,"
                        + " mapping.supplier_sku_code, mapping.preferred,"
                        + " mapping.lead_time_days " + from
                        + " ORDER BY mapping.preferred DESC, supplier.business_code, supplier.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new ProcurementSupplierOption(
                        resultSet.getObject(1, UUID.class), resultSet.getString(2),
                        resultSet.getString(3), resultSet.getString(4),
                        resultSet.getBoolean(5),
                        resultSet.getObject(6, Integer.class)));
        Long total = jdbc.queryForObject("SELECT count(*) " + from, parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Page<ProcurementSupplierOption> listSupplierOptionsForSku(
            UUID tenantId, UUID skuId, String keyword, Pageable pageable) {
        String filter = keyword == null ? "" : """
                 AND (lower(supplier.business_code) LIKE '%' || :keyword || '%'
                   OR lower(supplier.name) LIKE '%' || :keyword || '%'
                   OR lower(coalesce(mapping.supplier_sku_code, '')) LIKE '%' || :keyword || '%')
                """;
        String from = """
                FROM tenant_product_skus sku
                JOIN tenant_product_spus spu
                  ON spu.tenant_id = sku.tenant_id AND spu.id = sku.spu_id
                 AND spu.status = 'ACTIVE'
                JOIN tenant_supplier_sku_mappings mapping
                  ON mapping.tenant_id = sku.tenant_id
                 AND mapping.sku_id = sku.id
                 AND mapping.status = 'ACTIVE'
                JOIN tenant_suppliers supplier
                  ON supplier.tenant_id = mapping.tenant_id
                 AND supplier.id = mapping.supplier_id
                 AND supplier.status = 'ACTIVE'
                WHERE sku.tenant_id = :tenantId AND sku.id = :skuId
                  AND sku.status = 'ACTIVE'
                """ + filter;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("skuId", skuId)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementSupplierOption> rows = jdbc.query(
                "SELECT supplier.id, supplier.business_code, supplier.name,"
                        + " mapping.supplier_sku_code, mapping.preferred,"
                        + " mapping.lead_time_days " + from
                        + " ORDER BY mapping.preferred DESC, supplier.business_code, supplier.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                (resultSet, rowNumber) -> new ProcurementSupplierOption(
                        resultSet.getObject(1, UUID.class), resultSet.getString(2),
                        resultSet.getString(3), resultSet.getString(4),
                        resultSet.getBoolean(5),
                        resultSet.getObject(6, Integer.class)));
        Long total = jdbc.queryForObject("SELECT count(*) " + from, parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<CreateFacts> findCreateFacts(
            UUID tenantId, UUID planId, UUID supplierId) {
        return optionalQuery(
                """
                SELECT plan.plan_no, plan.sku_id, plan.sku_code_snapshot,
                       plan.sku_name_snapshot, plan.sku_variant_snapshot,
                       plan.warehouse_id, plan.warehouse_code_snapshot,
                       plan.warehouse_name_snapshot, plan.location_id,
                       plan.location_code_snapshot, plan.location_name_snapshot,
                       plan.quantity, supplier.id AS supplier_id,
                       supplier.business_code AS supplier_code,
                       supplier.name AS supplier_name, mapping.supplier_sku_code
                FROM procurement_plans plan
                JOIN tenant_supplier_sku_mappings mapping
                  ON mapping.tenant_id = plan.tenant_id
                 AND mapping.sku_id = plan.sku_id
                 AND mapping.supplier_id = :supplierId
                 AND mapping.status = 'ACTIVE'
                JOIN tenant_suppliers supplier
                  ON supplier.tenant_id = mapping.tenant_id
                 AND supplier.id = mapping.supplier_id
                 AND supplier.status = 'ACTIVE'
                WHERE plan.tenant_id = :tenantId AND plan.id = :planId
                FOR SHARE OF mapping, supplier
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("planId", planId)
                        .addValue("supplierId", supplierId),
                (resultSet, rowNumber) -> new CreateFacts(
                        resultSet.getString("plan_no"),
                        resultSet.getObject("supplier_id", UUID.class),
                        resultSet.getString("supplier_code"),
                        resultSet.getString("supplier_name"),
                        resultSet.getString("supplier_sku_code"),
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
                        resultSet.getLong("quantity")));
    }

    public Optional<CreateFacts> findDirectCreateFacts(
            UUID tenantId, UUID skuId, UUID warehouseId, UUID locationId,
            UUID supplierId, long quantity) {
        return optionalQuery(
                """
                SELECT supplier.id AS supplier_id,
                       supplier.business_code AS supplier_code,
                       supplier.name AS supplier_name,
                       mapping.supplier_sku_code,
                       sku.id AS sku_id, sku.business_code AS sku_code,
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
                 AND spu.status = 'ACTIVE'
                JOIN tenant_supplier_sku_mappings mapping
                  ON mapping.tenant_id = sku.tenant_id
                 AND mapping.sku_id = sku.id
                 AND mapping.supplier_id = :supplierId
                 AND mapping.status = 'ACTIVE'
                JOIN tenant_suppliers supplier
                  ON supplier.tenant_id = mapping.tenant_id
                 AND supplier.id = mapping.supplier_id
                 AND supplier.status = 'ACTIVE'
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = sku.tenant_id
                 AND warehouse.id = :warehouseId
                 AND warehouse.status = 'ACTIVE'
                JOIN tenant_warehouse_locations location
                  ON location.tenant_id = warehouse.tenant_id
                 AND location.warehouse_id = warehouse.id
                 AND location.id = :locationId
                 AND location.status = 'ACTIVE'
                WHERE sku.tenant_id = :tenantId AND sku.id = :skuId
                  AND sku.status = 'ACTIVE'
                FOR SHARE OF sku, spu, mapping, supplier, warehouse, location
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("locationId", locationId)
                        .addValue("supplierId", supplierId),
                (resultSet, rowNumber) -> new CreateFacts(
                        null,
                        resultSet.getObject("supplier_id", UUID.class),
                        resultSet.getString("supplier_code"),
                        resultSet.getString("supplier_name"),
                        resultSet.getString("supplier_sku_code"),
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("warehouse_code"),
                        resultSet.getString("warehouse_name"),
                        resultSet.getObject("location_id", UUID.class),
                        resultSet.getString("location_code"),
                        resultSet.getString("location_name"),
                        quantity));
    }

    public void insert(
            UUID id, UUID tenantId, String purchaseNo, UUID planId,
            CreateFacts facts, String orderNote, String actorDisplayName,
            UUID actorUserId, UUID actorSystemAdminId) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_orders (
                    id, tenant_id, purchase_no, status, plan_id,
                    plan_no_snapshot, supplier_id, supplier_code_snapshot,
                    supplier_name_snapshot, supplier_sku_code_snapshot,
                    sku_id, sku_code_snapshot, sku_name_snapshot,
                    sku_variant_snapshot, warehouse_id,
                    warehouse_code_snapshot, warehouse_name_snapshot,
                    location_id, location_code_snapshot, location_name_snapshot,
                    quantity, order_note, ordered_by_display_name,
                    ordered_by_user_id, ordered_by_system_admin_id
                ) VALUES (
                    :id, :tenantId, :purchaseNo, 'NEW_ORDER', :planId,
                    :planNo, :supplierId, :supplierCode, :supplierName,
                    :supplierSkuCode, :skuId, :skuCode, :skuName, :skuVariant,
                    :warehouseId, :warehouseCode, :warehouseName,
                    :locationId, :locationCode, :locationName, :quantity,
                    :orderNote, :actorDisplayName, :actorUserId, :actorSystemAdminId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id).addValue("tenantId", tenantId)
                        .addValue("purchaseNo", purchaseNo).addValue("planId", planId)
                        .addValue("planNo", facts.planNo())
                        .addValue("supplierId", facts.supplierId())
                        .addValue("supplierCode", facts.supplierCode())
                        .addValue("supplierName", facts.supplierName())
                        .addValue("supplierSkuCode", facts.supplierSkuCode())
                        .addValue("skuId", facts.skuId()).addValue("skuCode", facts.skuCode())
                        .addValue("skuName", facts.skuName()).addValue("skuVariant", facts.skuVariant())
                        .addValue("warehouseId", facts.warehouseId())
                        .addValue("warehouseCode", facts.warehouseCode())
                        .addValue("warehouseName", facts.warehouseName())
                        .addValue("locationId", facts.locationId())
                        .addValue("locationCode", facts.locationCode())
                        .addValue("locationName", facts.locationName())
                        .addValue("quantity", facts.quantity()).addValue("orderNote", orderNote)
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId));
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":procurement-order:" + commandId),
                Object.class);
    }

    public Optional<CommandRecord> findCommand(UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT purchase_order_id, request_fingerprint
                FROM procurement_purchase_order_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                Map.of("tenantId", tenantId, "commandId", commandId),
                (resultSet, rowNumber) -> new CommandRecord(
                        resultSet.getObject(1, UUID.class), resultSet.getString(2)));
    }

    public void insertCommand(
            UUID tenantId, UUID commandId, UUID purchaseOrderId,
            String fingerprint) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_order_commands (
                    tenant_id, command_id, purchase_order_id, request_fingerprint
                ) VALUES (:tenantId, :commandId, :purchaseOrderId, :fingerprint)
                """,
                Map.of(
                        "tenantId", tenantId, "commandId", commandId,
                        "purchaseOrderId", purchaseOrderId,
                        "fingerprint", fingerprint));
    }

    public void lockReceiptCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":procurement-receipt:" + commandId),
                Object.class);
    }

    public Optional<ReceiptCommandRecord> findReceiptCommand(
            UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT purchase_order_id, request_fingerprint, result_version
                FROM procurement_purchase_order_receipt_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                Map.of("tenantId", tenantId, "commandId", commandId),
                (resultSet, rowNumber) -> new ReceiptCommandRecord(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getString(2), resultSet.getLong(3)));
    }

    public void insertReceipt(
            UUID id, UUID tenantId, UUID purchaseOrderId, long quantity,
            UUID inventoryEventId, String actorDisplayName, UUID actorUserId,
            UUID actorSystemAdminId, String requestId) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_order_receipts (
                    id, tenant_id, purchase_order_id, quantity,
                    inventory_event_id, received_by_display_name,
                    received_by_user_id, received_by_system_admin_id,
                    request_id
                ) VALUES (
                    :id, :tenantId, :purchaseOrderId, :quantity,
                    :inventoryEventId, :actorDisplayName, :actorUserId,
                    :actorSystemAdminId, :requestId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id).addValue("tenantId", tenantId)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("quantity", quantity)
                        .addValue("inventoryEventId", inventoryEventId)
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId));
    }

    public int markReceived(
            UUID tenantId, UUID purchaseOrderId, long expectedVersion,
            long quantity, ProcurementPurchaseOrderStatus status) {
        return jdbc.update(
                """
                UPDATE procurement_purchase_orders
                SET received_quantity = received_quantity + :quantity,
                    status = :status,
                    last_received_at = now(),
                    version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :purchaseOrderId
                  AND version = :expectedVersion
                  AND status IN ('APPROVED', 'PARTIALLY_RECEIVED')
                  AND received_quantity + :quantity <= quantity
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("quantity", quantity)
                        .addValue("status", status.name()));
    }

    public void insertReceiptCommand(
            UUID tenantId, UUID commandId, UUID purchaseOrderId,
            String fingerprint, long resultVersion) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_order_receipt_commands (
                    tenant_id, command_id, purchase_order_id,
                    request_fingerprint, result_version
                ) VALUES (
                    :tenantId, :commandId, :purchaseOrderId,
                    :fingerprint, :resultVersion
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("fingerprint", fingerprint)
                        .addValue("resultVersion", resultVersion));
    }

    public int review(
            UUID tenantId, UUID purchaseOrderId, long expectedVersion,
            boolean approved, String reviewNote, String actorDisplayName,
            UUID actorUserId, UUID actorSystemAdminId) {
        return jdbc.update(
                """
                UPDATE procurement_purchase_orders
                SET status = :status,
                    review_decision = :decision,
                    review_note = :reviewNote,
                    reviewed_by_display_name = :actorDisplayName,
                    reviewed_by_user_id = :actorUserId,
                    reviewed_by_system_admin_id = :actorSystemAdminId,
                    reviewed_at = now(),
                    version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :purchaseOrderId
                  AND version = :expectedVersion
                  AND status = 'NEW_ORDER'
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("status", approved ? "APPROVED" : "REJECTED")
                        .addValue("decision", approved ? "APPROVED" : "REJECTED")
                        .addValue("reviewNote", reviewNote)
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId));
    }

    private static String where(
            boolean allWarehouses, UUID warehouseId, UUID supplierId,
            ProcurementPurchaseOrderStatus status, boolean receivableOnly,
            ProcurementPurchaseOrderSearchField searchField, String keyword,
            Instant createdFrom, Instant createdTo) {
        StringBuilder where = new StringBuilder(
                " WHERE purchase_order.tenant_id = :tenantId");
        if (!allWarehouses) where.append(" AND purchase_order.warehouse_id IN (:warehouseScope)");
        if (warehouseId != null) where.append(" AND purchase_order.warehouse_id = :warehouseId");
        if (supplierId != null) where.append(" AND purchase_order.supplier_id = :supplierId");
        if (status != null) where.append(" AND purchase_order.status = :status");
        else if (receivableOnly) {
            where.append(" AND purchase_order.status IN ('APPROVED', 'PARTIALLY_RECEIVED')");
        }
        if (keyword != null) {
            where.append(" AND lower(").append(switch (searchField) {
                case PURCHASE_NO -> "purchase_order.purchase_no";
                case PLAN_NO -> "purchase_order.plan_no_snapshot";
                case SKU_CODE -> "purchase_order.sku_code_snapshot";
                case SKU_NAME -> "purchase_order.sku_name_snapshot";
                case SUPPLIER_NAME -> "purchase_order.supplier_name_snapshot";
                case ORDER_NOTE -> "coalesce(purchase_order.order_note, '')";
                case ORDERED_BY -> "purchase_order.ordered_by_display_name";
            }).append(") LIKE '%' || :keyword || '%'");
        }
        if (createdFrom != null) where.append(" AND purchase_order.created_at >= :createdFrom");
        if (createdTo != null) where.append(" AND purchase_order.created_at <= :createdTo");
        return where.toString();
    }

    private static String receiptWhere(
            boolean allWarehouses, UUID purchaseOrderId,
            String supplierKeyword, String purchaseKeyword,
            Instant receivedFrom, Instant receivedTo) {
        StringBuilder where = new StringBuilder(
                " WHERE receipt.tenant_id = :tenantId");
        if (!allWarehouses) {
            where.append(" AND purchase_order.warehouse_id IN (:warehouseScope)");
        }
        if (purchaseOrderId != null) {
            where.append(" AND receipt.purchase_order_id = :purchaseOrderId");
        }
        if (supplierKeyword != null) {
            where.append(" AND (lower(purchase_order.supplier_code_snapshot)"
                    + " LIKE '%' || :supplierKeyword || '%'"
                    + " OR lower(purchase_order.supplier_name_snapshot)"
                    + " LIKE '%' || :supplierKeyword || '%')");
        }
        if (purchaseKeyword != null) {
            where.append(" AND (lower(purchase_order.purchase_no)"
                    + " LIKE '%' || :purchaseKeyword || '%'"
                    + " OR lower(purchase_order.plan_no_snapshot)"
                    + " LIKE '%' || :purchaseKeyword || '%')");
        }
        if (receivedFrom != null) {
            where.append(" AND receipt.received_at >= :receivedFrom");
        }
        if (receivedTo != null) {
            where.append(" AND receipt.received_at <= :receivedTo");
        }
        return where.toString();
    }

    private static String receiptOrder(ProcurementReceiptSort sort) {
        return switch (sort == null ? ProcurementReceiptSort.RECEIVED_AT : sort) {
            case RECEIVED_AT -> " ORDER BY receipt.received_at DESC, receipt.id DESC";
            case SKU_CODE -> " ORDER BY purchase_order.sku_code_snapshot, receipt.received_at DESC, receipt.id DESC";
            case PURCHASE_NO -> " ORDER BY purchase_order.purchase_no, receipt.received_at DESC, receipt.id DESC";
        };
    }

    private static ProcurementPurchaseOrderView mapOrder(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new ProcurementPurchaseOrderView(
                resultSet.getObject("id", UUID.class), resultSet.getString("purchase_no"),
                ProcurementPurchaseOrderStatus.valueOf(resultSet.getString("status")),
                resultSet.getObject("plan_id", UUID.class), resultSet.getString("plan_no_snapshot"),
                resultSet.getObject("supplier_id", UUID.class), resultSet.getString("supplier_code_snapshot"),
                resultSet.getString("supplier_name_snapshot"), resultSet.getString("supplier_sku_code_snapshot"),
                resultSet.getObject("sku_id", UUID.class), resultSet.getString("sku_code_snapshot"),
                resultSet.getString("sku_name_snapshot"), resultSet.getString("sku_variant_snapshot"),
                resultSet.getObject("warehouse_id", UUID.class), resultSet.getString("warehouse_code_snapshot"),
                resultSet.getString("warehouse_name_snapshot"), resultSet.getObject("location_id", UUID.class),
                resultSet.getString("location_code_snapshot"), resultSet.getString("location_name_snapshot"),
                resultSet.getLong("quantity"), resultSet.getLong("received_quantity"),
                resultSet.getString("order_note"),
                resultSet.getString("ordered_by_display_name"),
                resultSet.getString("review_decision"),
                resultSet.getString("review_note"),
                resultSet.getString("reviewed_by_display_name"),
                nullableInstant(resultSet, "reviewed_at"),
                resultSet.getLong("version"),
                nullableInstant(resultSet, "last_received_at"),
                instant(resultSet, "created_at"), instant(resultSet, "updated_at"));
    }

    private static ProcurementReceiptView mapReceipt(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new ProcurementReceiptView(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("purchase_order_id", UUID.class),
                resultSet.getString("purchase_no"),
                resultSet.getString("plan_no_snapshot"),
                resultSet.getObject("supplier_id", UUID.class),
                resultSet.getString("supplier_code_snapshot"),
                resultSet.getString("supplier_name_snapshot"),
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
                resultSet.getObject("inventory_event_id", UUID.class),
                resultSet.getLong("ledger_sequence"),
                resultSet.getLong("balance_after"),
                resultSet.getString("received_by_display_name"),
                instant(resultSet, "received_at"));
    }

    private static Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private static Instant nullableInstant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private <T> Optional<T> optionalQuery(
            String sql, Object parameters,
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
            String planNo,
            UUID supplierId,
            String supplierCode,
            String supplierName,
            String supplierSkuCode,
            UUID skuId,
            String skuCode,
            String skuName,
            String skuVariant,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            UUID locationId,
            String locationCode,
            String locationName,
            long quantity) {
    }

    public record CommandRecord(UUID purchaseOrderId, String fingerprint) {
    }

    public record ReceiptCommandRecord(
            UUID purchaseOrderId, String fingerprint, long resultVersion) {
    }
}
