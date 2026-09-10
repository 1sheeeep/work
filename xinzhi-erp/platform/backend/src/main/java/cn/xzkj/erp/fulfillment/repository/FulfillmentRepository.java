package cn.xzkj.erp.fulfillment.repository;

import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PauseState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShortageState;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus;
import static cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.EligibleLine;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.EligibleOrder;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Line;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Package;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PlanSummary;

@Repository
public class FulfillmentRepository {

    private final JdbcTemplate jdbc;

    public FulfillmentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<EligibleOrder> findEligibleOrderForUpdate(UUID tenantId, UUID orderId) {
        var orders = jdbc.query("""
                select id, shop_id, external_order_ref, version
                from tenant_orders
                where tenant_id = ? and id = ? and status = 'READY_TO_FULFILL'
                for update
                """, (rs, row) -> new Object[] {
                        rs.getObject("id", UUID.class),
                        rs.getObject("shop_id", UUID.class),
                        rs.getString("external_order_ref"),
                        rs.getLong("version")
                }, tenantId, orderId);
        if (orders.isEmpty()) {
            return Optional.empty();
        }
        var row = orders.getFirst();
        List<EligibleLine> lines = jdbc.query("""
                select l.id, l.sku_id, l.external_line_ref, l.quantity,
                       s.business_code, s.name
                from tenant_order_lines l
                join tenant_product_skus s
                  on s.tenant_id = l.tenant_id and s.id = l.sku_id
                where l.tenant_id = ? and l.order_id = ?
                  and l.sku_id is not null and l.sku_match_source <> 'UNMATCHED'
                order by l.external_line_ref, l.id
                """, (rs, n) -> new EligibleLine(
                        rs.getObject("id", UUID.class),
                        rs.getObject("sku_id", UUID.class),
                        rs.getString("external_line_ref"),
                        rs.getInt("quantity"),
                        rs.getString("business_code"),
                        rs.getString("name")), tenantId, orderId);
        Integer expected = jdbc.queryForObject("""
                select line_count from tenant_orders where tenant_id = ? and id = ?
                """, Integer.class, tenantId, orderId);
        if (expected == null || lines.size() != expected) {
            return Optional.empty();
        }
        return Optional.of(new EligibleOrder(
                (UUID) row[0], (UUID) row[1], (String) row[2], (Long) row[3], lines));
    }

    public Optional<Plan> findByCreationKey(UUID tenantId, String key) {
        return jdbc.query("""
                select id from tenant_fulfillment_plans
                where tenant_id = ? and creation_idempotency_key = ?
                """, (rs, row) -> rs.getObject(1, UUID.class), tenantId, key).stream()
                .findFirst().flatMap(id -> find(tenantId, id, false));
    }

    public Optional<Plan> findByOrderId(
            UUID tenantId, UUID orderId) {
        return jdbc.query("""
                select id from tenant_fulfillment_plans
                where tenant_id = ? and order_id = ?
                """, (rs, row) -> rs.getObject(1, UUID.class),
                tenantId, orderId).stream().findFirst()
                .flatMap(id -> find(tenantId, id, false));
    }

    public void lockCreationKey(UUID tenantId, String key) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, tenantId + ":fulfillment:create:" + key);
    }

    public void insertPlan(UUID id, UUID tenantId, EligibleOrder order, String key, String fingerprint) {
        int planned = order.lines().stream().mapToInt(EligibleLine::quantity).sum();
        jdbc.update("""
                insert into tenant_fulfillment_plans (
                    id, tenant_id, order_id, shop_id, source_order_version,
                    external_order_ref_snapshot, planned_quantity,
                    creation_idempotency_key, request_fingerprint
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, tenantId, order.id(), order.shopId(), order.version(),
                order.externalOrderRef(), planned, key, fingerprint);
        short sequence = 0;
        for (EligibleLine line : order.lines()) {
            jdbc.update("""
                    insert into tenant_fulfillment_lines (
                        id, tenant_id, plan_id, order_line_id, split_sequence, sku_id,
                        planned_quantity, external_line_ref_snapshot,
                        sku_business_code_snapshot, sku_name_snapshot
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, UUID.randomUUID(), tenantId, id, line.orderLineId(), sequence++,
                    line.skuId(), line.quantity(), line.externalLineRef(),
                    line.skuBusinessCode(), line.skuName());
        }
        updateOrderStatus(
                tenantId, order.id(), "READY_TO_FULFILL", "FULFILLING");
    }

    public void updateOrderStatus(
            UUID tenantId, UUID orderId, String expectedStatus,
            String targetStatus) {
        int changed = jdbc.update("""
                update tenant_orders
                set status = ?, hold_reason = null,
                    version = version + 1, updated_at = now()
                where tenant_id = ? and id = ? and status = ?
                """, targetStatus, tenantId, orderId, expectedStatus);
        if (changed != 1) {
            throw new IllegalStateException("order state conflict");
        }
    }

    public void updateFulfillmentOrderStatus(
            UUID tenantId, UUID orderId, String targetStatus) {
        int changed = jdbc.update("""
                update tenant_orders
                set status = ?, hold_reason = null,
                    version = version + 1, updated_at = now()
                where tenant_id = ? and id = ?
                  and status in ('FULFILLING', 'SHIPPED')
                """, targetStatus, tenantId, orderId);
        if (changed != 1) {
            throw new IllegalStateException("order state conflict");
        }
    }

    public Optional<Plan> lock(UUID tenantId, UUID planId) {
        jdbc.query("""
                select id from tenant_fulfillment_plans
                where tenant_id = ? and id = ? for update
                """, rs -> { }, tenantId, planId);
        return find(tenantId, planId, false);
    }

    public Optional<Plan> find(UUID tenantId, UUID planId, boolean includeEvents) {
        List<Plan> plans = jdbc.query("""
                select * from tenant_fulfillment_plans where tenant_id = ? and id = ?
                """, (rs, row) -> mapPlan(rs, List.of(), List.of()), tenantId, planId);
        if (plans.isEmpty()) {
            return Optional.empty();
        }
        Plan base = plans.getFirst();
        return Optional.of(copyWithChildren(base, lines(tenantId, planId), packages(tenantId, planId)));
    }

    public List<PlanSummary> list(
            UUID tenantId, Status status, UUID shopId, String keyword,
            int page, int size, boolean allWarehouses, UUID scopedUserId) {
        String pattern = keyword == null ? null : "%" + escapeLike(keyword.strip().toLowerCase()) + "%";
        return jdbc.query("""
                select id, order_id, shop_id, external_order_ref_snapshot, status,
                       pause_state, pause_reason_code, shortage_state, planned_quantity,
                       shipped_quantity, cancelled_quantity, version, updated_at
                from tenant_fulfillment_plans
                where tenant_id = ?
                  and (cast(? as text) is null or status = ?)
                  and (cast(? as uuid) is null or shop_id = ?)
                  and (cast(? as text) is null
                       or lower(external_order_ref_snapshot) like ? escape '\\')
                  and (? = true or (
                    exists (
                      select 1 from tenant_fulfillment_warehouse_facts wf
                      where wf.tenant_id = tenant_fulfillment_plans.tenant_id
                        and wf.plan_id = tenant_fulfillment_plans.id
                    )
                    and not exists (
                      select 1 from tenant_fulfillment_warehouse_facts wf
                      where wf.tenant_id = tenant_fulfillment_plans.tenant_id
                        and wf.plan_id = tenant_fulfillment_plans.id
                        and not exists (
                          select 1 from tenant_user_warehouse_scope_items scope_item
                          where scope_item.tenant_id = wf.tenant_id
                            and scope_item.user_id = ?
                            and scope_item.warehouse_id = wf.warehouse_id
                        )
                    )
                  ))
                order by updated_at desc, id desc
                limit ? offset ?
                """, (rs, row) -> new PlanSummary(
                        uuid(rs, "id"), uuid(rs, "order_id"), uuid(rs, "shop_id"),
                        rs.getString("external_order_ref_snapshot"), Status.valueOf(rs.getString("status")),
                        PauseState.valueOf(rs.getString("pause_state")), rs.getString("pause_reason_code"),
                        ShortageState.valueOf(rs.getString("shortage_state")),
                        rs.getInt("planned_quantity"), rs.getInt("shipped_quantity"),
                        rs.getInt("cancelled_quantity"), rs.getLong("version"),
                        instant(rs, "updated_at")),
                tenantId, status == null ? null : status.name(), status == null ? null : status.name(),
                shopId, shopId, pattern, pattern, allWarehouses, scopedUserId,
                size, Math.multiplyExact(page, size));
    }

    public long count(
            UUID tenantId, Status status, UUID shopId, String keyword,
            boolean allWarehouses, UUID scopedUserId) {
        String pattern = keyword == null ? null : "%" + escapeLike(keyword.strip().toLowerCase()) + "%";
        Long count = jdbc.queryForObject("""
                select count(*) from tenant_fulfillment_plans
                where tenant_id = ?
                  and (cast(? as text) is null or status = ?)
                  and (cast(? as uuid) is null or shop_id = ?)
                  and (cast(? as text) is null
                       or lower(external_order_ref_snapshot) like ? escape '\\')
                  and (? = true or (
                    exists (
                      select 1 from tenant_fulfillment_warehouse_facts wf
                      where wf.tenant_id = tenant_fulfillment_plans.tenant_id
                        and wf.plan_id = tenant_fulfillment_plans.id
                    )
                    and not exists (
                      select 1 from tenant_fulfillment_warehouse_facts wf
                      where wf.tenant_id = tenant_fulfillment_plans.tenant_id
                        and wf.plan_id = tenant_fulfillment_plans.id
                        and not exists (
                          select 1 from tenant_user_warehouse_scope_items scope_item
                          where scope_item.tenant_id = wf.tenant_id
                            and scope_item.user_id = ?
                            and scope_item.warehouse_id = wf.warehouse_id
                        )
                    )
                  ))
                """, Long.class, tenantId,
                status == null ? null : status.name(), status == null ? null : status.name(),
                shopId, shopId, pattern, pattern, allWarehouses, scopedUserId);
        return count == null ? 0 : count;
    }

    public List<UUID> warehouseIds(UUID tenantId, UUID planId) {
        return jdbc.query("""
                select warehouse_id
                from tenant_fulfillment_warehouse_facts
                where tenant_id = ? and plan_id = ?
                order by warehouse_id
                """, (rs, row) -> uuid(rs, "warehouse_id"),
                tenantId, planId);
    }

    public List<UUID> orderWarehouseIds(UUID tenantId, UUID orderId) {
        return jdbc.query("""
                select warehouse_id
                from tenant_order_warehouse_facts
                where tenant_id = ? and order_id = ?
                order by warehouse_id
                """, (rs, row) -> uuid(rs, "warehouse_id"),
                tenantId, orderId);
    }

    public void allocate(UUID tenantId, UUID planId, UUID lineId, UUID warehouseId,
            UUID locationId, String inventoryRef) {
        int changed = jdbc.update("""
                update tenant_fulfillment_lines
                set warehouse_id = ?, location_id = ?, inventory_operation_ref = ?, updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                """, warehouseId, locationId, inventoryRef, tenantId, planId, lineId);
        if (changed != 1) {
            throw new IllegalStateException("missing fulfillment line");
        }
    }

    public void replaceAllocations(UUID tenantId, UUID planId, List<AllocatedLine> allocations) {
        jdbc.update("""
                delete from tenant_fulfillment_lines
                where tenant_id = ? and plan_id = ?
                """, tenantId, planId);
        for (AllocatedLine line : allocations) {
            jdbc.update("""
                    insert into tenant_fulfillment_lines (
                        id, tenant_id, plan_id, order_line_id, split_sequence, sku_id,
                        warehouse_id, location_id, planned_quantity,
                        external_line_ref_snapshot, sku_business_code_snapshot,
                        sku_name_snapshot, inventory_operation_ref
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, line.id(), tenantId, planId, line.orderLineId(), line.splitSequence(),
                    line.skuId(), line.warehouseId(), line.locationId(), line.quantity(),
                    line.externalLineRef(), line.skuBusinessCode(), line.skuName(),
                    line.inventoryOperationRef());
        }
    }

    public boolean warehouseAssignable(UUID tenantId, UUID warehouseId, UUID locationId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from tenant_warehouses w
                where w.tenant_id = ? and w.id = ? and w.status = 'ACTIVE'
                  and (cast(? as uuid) is null or exists (
                    select 1 from tenant_warehouse_locations l
                    where l.tenant_id = w.tenant_id and l.warehouse_id = w.id
                      and l.id = ? and l.status = 'ACTIVE'
                  ))
                """, Integer.class, tenantId, warehouseId, locationId, locationId);
        return count != null && count == 1;
    }

    public void updatePlanState(UUID tenantId, UUID planId, Status status,
            PauseState pauseState, String pauseReason, ShortageState shortageState,
            Status resumeStatus, int picked, int packed, int shipped, int cancelled, long expectedVersion) {
        int changed = jdbc.update("""
                update tenant_fulfillment_plans
                set status = ?, pause_state = ?, pause_reason_code = ?, shortage_state = ?,
                    resume_status = ?, picked_quantity = ?, packed_quantity = ?,
                    shipped_quantity = ?, cancelled_quantity = ?, version = version + 1,
                    updated_at = now(),
                    completed_at = case when ? in ('SHIPPED','PARTIALLY_FULFILLED','CANCELLED')
                                        then now() else null end
                where tenant_id = ? and id = ? and version = ?
                """, status.name(), pauseState.name(), pauseReason, shortageState.name(),
                resumeStatus == null ? null : resumeStatus.name(), picked, packed, shipped, cancelled,
                status.name(), tenantId, planId, expectedVersion);
        if (changed != 1) {
            throw new IllegalStateException("stale fulfillment plan");
        }
    }

    public void updateLineProgress(UUID tenantId, UUID planId, UUID lineId,
            int picked, int packed, int shipped, int cancelled) {
        int changed = jdbc.update("""
                update tenant_fulfillment_lines
                set picked_quantity = ?, packed_quantity = ?, shipped_quantity = ?,
                    cancelled_quantity = ?, updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                """, picked, packed, shipped, cancelled, tenantId, planId, lineId);
        if (changed != 1) {
            throw new IllegalStateException("missing fulfillment line");
        }
    }

    public void insertPackage(UUID packageId, UUID tenantId, UUID planId, UUID warehouseId,
            String packageNumber, List<PackageItem> items) {
        jdbc.update("""
                insert into tenant_fulfillment_packages
                    (id, tenant_id, plan_id, warehouse_id, package_number)
                values (?, ?, ?, ?, ?)
                """, packageId, tenantId, planId, warehouseId, packageNumber);
        for (PackageItem item : items) {
            jdbc.update("""
                    insert into tenant_fulfillment_package_items
                        (tenant_id, package_id, fulfillment_line_id, quantity)
                    values (?, ?, ?, ?)
                    """, tenantId, packageId, item.fulfillmentLineId(), item.quantity());
        }
        autoAssignSingleSkuPackaging(tenantId, planId, packageId, warehouseId);
    }

    public void sealPackage(UUID tenantId, UUID planId, UUID packageId, long expectedVersion) {
        int changed = jdbc.update("""
                with item_weight as (
                  select sum(sku.standard_weight_grams * item.quantity)::bigint as grams,
                         bool_and(sku.standard_weight_grams is not null) as complete
                  from tenant_fulfillment_package_items item
                  join tenant_fulfillment_lines line
                    on line.tenant_id = item.tenant_id
                   and line.id = item.fulfillment_line_id
                  join tenant_product_skus sku
                    on sku.tenant_id = line.tenant_id and sku.id = line.sku_id
                  where item.tenant_id = ? and item.package_id = ?
                )
                update tenant_fulfillment_packages
                set status = 'SEALED', version = version + 1, sealed_at = now(),
                    expected_weight_grams = case when item_weight.complete
                      then item_weight.grams + packaging_weight_grams else null end,
                    weighing_status = case when item_weight.complete
                      then 'PENDING' else 'MISSING_WEIGHT' end,
                    updated_at = now()
                from item_weight
                where tenant_id = ? and plan_id = ? and id = ?
                  and status = 'DRAFT' and version = ?
                  and packaging_template_id is not null
                """, tenantId, packageId, tenantId, planId, packageId, expectedVersion);
        if (changed != 1) {
            throw new IllegalStateException("package state conflict");
        }
    }

    public void handoverPackage(UUID tenantId, UUID planId, UUID packageId, long expectedVersion,
            UUID eventId, Instant occurredAt, String eventRef,
            UUID actorUserId, String requestId, String carrierCode, String serviceCode,
            String trackingReference, UUID orderId, UUID shopId) {
        int changed = jdbc.update("""
                update tenant_fulfillment_packages
                set status = 'HANDED_OVER', version = version + 1,
                    handed_over_at = ?, updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                  and status = 'SEALED' and version = ?
                  and weighing_status in ('PASSED', 'OVERRIDDEN')
                  and weight_grams is not null
                """, Timestamp.from(occurredAt), tenantId, planId, packageId, expectedVersion);
        if (changed != 1) {
            throw new IllegalStateException("package state conflict");
        }
        jdbc.update("""
                insert into tenant_shipment_events (
                    id, tenant_id, plan_id, package_id, event_type, occurred_at,
                    source_system, external_event_ref, actor_user_id, request_id,
                    carrier_code, service_code, tracking_reference
                ) values (?, ?, ?, ?, 'HANDOVER_CONFIRMED', ?, 'ERP_LOCAL', ?, ?, ?, ?, ?, ?)
                """, eventId, tenantId, planId, packageId, Timestamp.from(occurredAt),
                eventRef, actorUserId, requestId, carrierCode, serviceCode, trackingReference);
        jdbc.update("""
                update tenant_orders
                   set logistics_channel = coalesce(?, ?),
                       tracking_status = 'IN_TRANSIT',
                       shipped_at = coalesce(shipped_at, ?),
                       updated_at = now()
                 where tenant_id = ? and id = ?
                """, serviceCode, carrierCode, Timestamp.from(occurredAt),
                tenantId, orderId);
        jdbc.update("""
                update tenant_order_profiles
                   set shipping_service = coalesce(?, ?),
                       tracking_reference = coalesce(?, tracking_reference),
                       handed_over_at = coalesce(handed_over_at, ?),
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and order_id = ?
                """, serviceCode, carrierCode, trackingReference,
                Timestamp.from(occurredAt), tenantId, orderId);
        claimManagedTrackingNumber(
                tenantId, planId, packageId, occurredAt, trackingReference);
        jdbc.update("""
                insert into tenant_order_outbox (
                    tenant_id, event_type, aggregate_type, aggregate_id, shop_id,
                    order_id, package_id, payload
                ) values (?, 'fulfillment.package.handed_over', 'fulfillment_plan', ?, ?, ?, ?,
                    jsonb_build_object('planId', ?, 'packageId', ?, 'shipmentEventId', ?))
                """, tenantId, planId, shopId, orderId, packageId,
                planId.toString(), packageId.toString(), eventId.toString());
    }

    private void claimManagedTrackingNumber(
            UUID tenantId, UUID planId, UUID packageId, Instant occurredAt,
            String trackingReference) {
        if (trackingReference == null) return;
        Integer managed = jdbc.queryForObject("""
                select count(*)
                from tenant_logistics_tracking_numbers
                where tenant_id = ? and tracking_reference = ?
                """, Integer.class, tenantId, trackingReference);
        if (managed == null || managed == 0) return;
        int changed = jdbc.update("""
                update tenant_logistics_tracking_numbers
                   set used_plan_id = ?, used_package_id = ?, used_at = ?,
                       version = version + 1, updated_at = now()
                 where tenant_id = ? and tracking_reference = ?
                   and lifecycle_status = 'ACTIVE'
                   and (used_package_id is null or used_package_id = ?)
                """, planId, packageId, Timestamp.from(occurredAt), tenantId,
                trackingReference, packageId);
        if (changed != 1) {
            throw new IllegalStateException("managed tracking number conflict");
        }
    }

    public void handoverPackage(UUID tenantId, UUID planId, UUID packageId, long expectedVersion,
            BigDecimal ignoredLegacyWeight, UUID eventId, Instant occurredAt, String eventRef,
            UUID actorUserId, String requestId, String carrierCode, String serviceCode,
            String trackingReference, UUID orderId, UUID shopId) {
        handoverPackage(tenantId, planId, packageId, expectedVersion, eventId,
                occurredAt, eventRef, actorUserId, requestId, carrierCode,
                serviceCode, trackingReference, orderId, shopId);
    }

    public Optional<UUID> handoverEventId(
            UUID tenantId, UUID planId, UUID packageId) {
        return jdbc.query("""
                select id
                from tenant_shipment_events
                where tenant_id = ? and plan_id = ? and package_id = ?
                  and event_type = 'HANDOVER_CONFIRMED'
                for update
                """, (rs, row) -> uuid(rs, "id"),
                tenantId, planId, packageId).stream().findFirst();
    }

    public void recordHandoverCorrection(
            UUID tenantId, UUID planId, UUID packageId,
            long expectedPackageVersion, UUID correctionEventId,
            UUID originalEventId, Instant occurredAt, String eventRef,
            UUID actorUserId, String requestId, String reasonCode,
            UUID orderId, UUID shopId) {
        int changed = jdbc.update("""
                update tenant_fulfillment_packages
                set status = 'HANDOVER_CORRECTED', version = version + 1,
                    updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                  and status = 'HANDED_OVER' and version = ?
                """, tenantId, planId, packageId, expectedPackageVersion);
        if (changed != 1) {
            throw new IllegalStateException("package state conflict");
        }
        jdbc.update("""
                insert into tenant_shipment_events (
                    id, tenant_id, plan_id, package_id, event_type,
                    occurred_at, source_system, external_event_ref,
                    actor_user_id, request_id, reverses_event_id,
                    correction_reason_code
                ) values (
                    ?, ?, ?, ?, 'HANDOVER_CORRECTION_RECORDED',
                    ?, 'ERP_LOCAL', ?, ?, ?, ?, ?
                )
                """, correctionEventId, tenantId, planId, packageId,
                Timestamp.from(occurredAt), eventRef, actorUserId, requestId,
                originalEventId, reasonCode);
        jdbc.update("""
                insert into tenant_order_outbox (
                    tenant_id, event_type, aggregate_type, aggregate_id,
                    shop_id, order_id, package_id, payload
                ) values (
                    ?, 'fulfillment.package.handover_corrected',
                    'fulfillment_plan', ?, ?, ?, ?,
                    jsonb_build_object(
                      'planId', ?, 'packageId', ?,
                      'originalShipmentEventId', ?,
                      'correctionShipmentEventId', ?
                    )
                )
                """, tenantId, planId, shopId, orderId, packageId,
                planId.toString(), packageId.toString(),
                originalEventId.toString(), correctionEventId.toString());
    }

    public void voidOpenPackages(UUID tenantId, UUID planId) {
        jdbc.update("""
                update tenant_fulfillment_packages
                set status = 'VOIDED', version = version + 1,
                    updated_at = now()
                where tenant_id = ? and plan_id = ?
                  and status in ('DRAFT', 'SEALED')
                """, tenantId, planId);
    }

    private void autoAssignSingleSkuPackaging(
            UUID tenantId, UUID planId, UUID packageId, UUID warehouseId) {
        jdbc.update("""
                with package_skus as (
                  select line.sku_id, sum(item.quantity)::integer as quantity,
                         count(*) as item_line_count
                  from tenant_fulfillment_package_items item
                  join tenant_fulfillment_lines line
                    on line.tenant_id = item.tenant_id
                   and line.id = item.fulfillment_line_id
                  where item.tenant_id = ? and item.package_id = ?
                  group by line.sku_id
                ), selected as (
                  select template.id, template.business_code, template.name,
                         template.standard_weight_grams
                  from package_skus package_sku
                  join tenant_sku_packaging_rules rule
                    on rule.tenant_id = ? and rule.sku_id = package_sku.sku_id
                   and rule.status = 'ACTIVE'
                   and package_sku.quantity between rule.min_quantity and rule.max_quantity
                  join tenant_packaging_templates template
                    on template.tenant_id = rule.tenant_id
                   and template.id = rule.packaging_template_id
                   and template.status = 'ACTIVE'
                  join tenant_warehouse_packaging_availability availability
                    on availability.tenant_id = template.tenant_id
                   and availability.packaging_template_id = template.id
                   and availability.warehouse_id = ? and availability.enabled
                  where (select count(*) from package_skus) = 1
                  order by rule.min_quantity desc, rule.id
                  limit 1
                ), item_weight as (
                  select sum(sku.standard_weight_grams * item.quantity)::bigint as grams,
                         bool_and(sku.standard_weight_grams is not null) as complete
                  from tenant_fulfillment_package_items item
                  join tenant_fulfillment_lines line
                    on line.tenant_id = item.tenant_id
                   and line.id = item.fulfillment_line_id
                  join tenant_product_skus sku
                    on sku.tenant_id = line.tenant_id and sku.id = line.sku_id
                  where item.tenant_id = ? and item.package_id = ?
                )
                update tenant_fulfillment_packages package
                set packaging_template_id = selected.id,
                    packaging_code_snapshot = selected.business_code,
                    packaging_name_snapshot = selected.name,
                    packaging_weight_grams = selected.standard_weight_grams,
                    expected_weight_grams = case when item_weight.complete
                      then item_weight.grams + selected.standard_weight_grams else null end,
                    weighing_status = case when item_weight.complete
                      then 'PENDING' else 'MISSING_WEIGHT' end,
                    updated_at = now()
                from selected, item_weight
                where package.tenant_id = ? and package.plan_id = ?
                  and package.id = ? and package.status = 'DRAFT'
                """, tenantId, packageId, tenantId, warehouseId,
                tenantId, packageId, tenantId, planId, packageId);
    }

    public Optional<CommandRecord> command(UUID tenantId, UUID commandId) {
        return jdbc.query("""
                select resource_id, command_type, request_fingerprint, response_version
                from tenant_fulfillment_commands
                where tenant_id = ? and command_id = ?
                """, (rs, row) -> new CommandRecord(
                        uuid(rs, "resource_id"),
                        rs.getString("command_type"),
                        rs.getString("request_fingerprint"),
                        rs.getLong("response_version")),
                tenantId, commandId).stream().findFirst();
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, tenantId + ":fulfillment:" + commandId);
    }

    public void recordCommand(UUID tenantId, UUID commandId, String resourceType, UUID resourceId,
            String commandType, String fingerprint, long responseVersion) {
        jdbc.update("""
                insert into tenant_fulfillment_commands (
                    tenant_id, command_id, resource_type, resource_id, command_type,
                    request_fingerprint, response_version
                ) values (?, ?, ?, ?, ?, ?, ?)
                """, tenantId, commandId, resourceType, resourceId, commandType,
                fingerprint, responseVersion);
    }

    private List<Line> lines(UUID tenantId, UUID planId) {
        return jdbc.query("""
                select * from tenant_fulfillment_lines
                where tenant_id = ? and plan_id = ?
                order by order_line_id, split_sequence, id
                """, (rs, row) -> new Line(
                        uuid(rs, "id"), uuid(rs, "order_line_id"),
                        rs.getShort("split_sequence"), uuid(rs, "sku_id"),
                        uuidOrNull(rs, "warehouse_id"), uuidOrNull(rs, "location_id"),
                        rs.getInt("planned_quantity"), rs.getInt("picked_quantity"),
                        rs.getInt("packed_quantity"), rs.getInt("shipped_quantity"),
                        rs.getInt("cancelled_quantity"), rs.getString("external_line_ref_snapshot"),
                        rs.getString("sku_business_code_snapshot"), rs.getString("sku_name_snapshot"),
                        rs.getString("inventory_operation_ref"), rs.getString("exception_code")),
                tenantId, planId);
    }

    private List<Package> packages(UUID tenantId, UUID planId) {
        return jdbc.query("""
                select pkg.*,
                       coalesce(publication.status, 'NOT_PUBLISHED')
                           as shopify_publication_status,
                       publication.notify_customer as shopify_notify_customer,
                       publication.tracking_url as shopify_tracking_url,
                       publication.external_fulfillment_ref,
                       publication.published_at as shopify_published_at,
                       coalesce(shipment.carrier_code,
                                pkg.logistics_provider_code) as carrier_code,
                       coalesce(shipment.service_code,
                                channel.channel_code) as service_code,
                       coalesce(shipment.tracking_reference,
                                pkg.logistics_tracking_reference)
                           as tracking_reference,
                       authorization_profile.provider_name as logistics_provider_name,
                       authorization_profile.account_label as logistics_account_label,
                       channel.channel_name as logistics_channel_name
                from tenant_fulfillment_packages pkg
                left join lateral (
                  select event.carrier_code, event.service_code,
                         event.tracking_reference
                  from tenant_shipment_events event
                  where event.tenant_id = pkg.tenant_id
                    and event.plan_id = pkg.plan_id
                    and event.package_id = pkg.id
                    and event.event_type = 'HANDOVER_CONFIRMED'
                  order by event.occurred_at desc, event.id desc
                  limit 1
                ) shipment on true
                left join tenant_logistics_authorizations authorization_profile
                  on authorization_profile.tenant_id = pkg.tenant_id
                 and authorization_profile.id = pkg.logistics_authorization_id
                left join tenant_logistics_authorization_channels channel
                  on channel.tenant_id = pkg.tenant_id
                 and channel.id = pkg.logistics_channel_id
                left join tenant_shopify_fulfillment_publications publication
                  on publication.tenant_id = pkg.tenant_id
                 and publication.package_id = pkg.id
                where pkg.tenant_id = ? and pkg.plan_id = ?
                order by pkg.created_at, pkg.id
                """, (rs, row) -> new Package(
                        uuid(rs, "id"), uuid(rs, "warehouse_id"), rs.getString("package_number"),
                        PackageStatus.valueOf(rs.getString("status")), rs.getBigDecimal("weight_grams"),
                        uuidOrNull(rs, "packaging_template_id"),
                        rs.getString("packaging_code_snapshot"),
                        rs.getString("packaging_name_snapshot"),
                        longOrNull(rs, "packaging_weight_grams"),
                        longOrNull(rs, "expected_weight_grams"),
                        longOrNull(rs, "allowed_tolerance_grams"),
                        longOrNull(rs, "weight_difference_grams"),
                        cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.WeighingStatus.valueOf(
                                rs.getString("weighing_status")),
                        rs.getString("weighing_source"),
                        uuidOrNull(rs, "shipping_scale_id"),
                        instantOrNull(rs, "weighed_at"),
                        rs.getLong("version"), instantOrNull(rs, "sealed_at"),
                        instantOrNull(rs, "handed_over_at"),
                        rs.getString("carrier_code"),
                        rs.getString("service_code"),
                        rs.getString("tracking_reference"),
                        uuidOrNull(rs, "logistics_authorization_id"),
                        uuidOrNull(rs, "logistics_channel_id"),
                        rs.getString("logistics_provider_code"),
                        rs.getString("logistics_provider_name"),
                        rs.getString("logistics_account_label"),
                        rs.getString("logistics_channel_name"),
                        rs.getString("logistics_client_reference"),
                        rs.getString("logistics_provider_order_reference"),
                        rs.getString("logistics_label_url"),
                        rs.getString("logistics_booking_status"),
                        rs.getString("logistics_tracking_status"),
                        rs.getString("logistics_tracking_summary"),
                        instantOrNull(rs, "logistics_last_synced_at"),
                        rs.getString("logistics_safe_error_code"),
                        rs.getBoolean("logistics_provider_handover_pending"),
                        ShopifyPublicationStatus.valueOf(
                                rs.getString("shopify_publication_status")),
                        (Boolean) rs.getObject("shopify_notify_customer"),
                        rs.getString("shopify_tracking_url"),
                        rs.getString("external_fulfillment_ref"),
                        instantOrNull(rs, "shopify_published_at"),
                        packageItems(tenantId, uuid(rs, "id"))),
                tenantId, planId);
    }

    private List<PackageItem> packageItems(UUID tenantId, UUID packageId) {
        return jdbc.query("""
                select fulfillment_line_id, quantity
                from tenant_fulfillment_package_items
                where tenant_id = ? and package_id = ?
                order by fulfillment_line_id
                """, (rs, row) -> new PackageItem(uuid(rs, "fulfillment_line_id"), rs.getInt("quantity")),
                tenantId, packageId);
    }

    private static Plan mapPlan(ResultSet rs, List<Line> lines, List<Package> packages) throws SQLException {
        return new Plan(
                uuid(rs, "id"), uuid(rs, "tenant_id"), uuid(rs, "order_id"), uuid(rs, "shop_id"),
                rs.getLong("source_order_version"), rs.getString("external_order_ref_snapshot"),
                Status.valueOf(rs.getString("status")), PauseState.valueOf(rs.getString("pause_state")),
                rs.getString("pause_reason_code"), ShortageState.valueOf(rs.getString("shortage_state")),
                enumOrNull(Status.class, rs.getString("resume_status")),
                rs.getInt("planned_quantity"), rs.getInt("picked_quantity"),
                rs.getInt("packed_quantity"), rs.getInt("shipped_quantity"),
                rs.getInt("cancelled_quantity"), rs.getLong("version"),
                instant(rs, "created_at"), instant(rs, "updated_at"),
                instantOrNull(rs, "completed_at"), lines, packages);
    }

    private static Plan copyWithChildren(Plan plan, List<Line> lines, List<Package> packages) {
        return new Plan(plan.id(), plan.tenantId(), plan.orderId(), plan.shopId(),
                plan.sourceOrderVersion(), plan.externalOrderRef(), plan.status(), plan.pauseState(),
                plan.pauseReasonCode(), plan.shortageState(), plan.resumeStatus(),
                plan.plannedQuantity(), plan.pickedQuantity(), plan.packedQuantity(),
                plan.shippedQuantity(), plan.cancelledQuantity(), plan.version(),
                plan.createdAt(), plan.updatedAt(), plan.completedAt(), lines, packages);
    }

    private static UUID uuid(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, UUID.class);
    }

    private static UUID uuidOrNull(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column) == null ? null : rs.getObject(column, UUID.class);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getTimestamp(column).toInstant();
    }

    private static Instant instantOrNull(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static Long longOrNull(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static <E extends Enum<E>> E enumOrNull(Class<E> type, String value) {
        return value == null ? null : Enum.valueOf(type, value);
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    public record AllocatedLine(
            UUID id,
            UUID orderLineId,
            short splitSequence,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            int quantity,
            String externalLineRef,
            String skuBusinessCode,
            String skuName,
            String inventoryOperationRef) {
    }

    public record CommandRecord(
            UUID resourceId,
            String commandType,
            String fingerprint,
            long responseVersion) {
    }
}
