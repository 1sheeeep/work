package cn.xzkj.erp.order.repository;

import java.time.Instant;
import java.util.Set;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.SkuMatchQueueItem;
import cn.xzkj.erp.order.domain.TenantOrder;
import jakarta.persistence.LockModeType;

public interface OrderRepository extends Repository<TenantOrder, UUID> {
    <S extends TenantOrder> S saveAndFlush(S entity);
    Optional<TenantOrder> findByIdAndTenantId(UUID id, UUID tenantId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select o from TenantOrder o
            where o.id = :id and o.tenantId = :tenantId
            """)
    Optional<TenantOrder> findForUpdate(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);
    Optional<TenantOrder> findByTenantIdAndIdempotencyKey(UUID tenantId, String idempotencyKey);
    boolean existsByTenantIdAndShopIdAndExternalOrderRef(
            UUID tenantId,
            UUID shopId,
            String externalOrderRef);

    @Query(value = """
            select warehouse_id
            from tenant_order_warehouse_facts
            where tenant_id = :tenantId and order_id = :orderId
            union
            select warehouse_id
            from tenant_orders
            where tenant_id = :tenantId and id = :orderId
              and warehouse_id is not null
            union
            select warehouse_id
            from tenant_order_lines
            where tenant_id = :tenantId and order_id = :orderId
              and warehouse_id is not null
            """, nativeQuery = true)
    Set<UUID> findWarehouseIds(
            @Param("tenantId") UUID tenantId,
            @Param("orderId") UUID orderId);

    @Query("""
            select o from TenantOrder o
            where o.tenantId = :tenantId
              and (:shopId is null or o.shopId = :shopId)
              and (:status is null or o.status = :status)
              and (:keywordPresent = false
                   or locate(:keyword, lower(o.externalOrderRef)) > 0
                   or locate(:keyword, lower(coalesce(o.buyerReference, ''))) > 0)
            order by o.placedAt desc, o.id desc
            """)
    Page<TenantOrder> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("shopId") UUID shopId,
            @Param("status") OrderStatus status,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable);

    /*
     * V33 guarantees UNMATCHED if and only if sku_id is null. Querying the null
     * side of that invariant keeps the V32 partial unmatched index eligible.
     */
    @Query(
            value = """
                    select new cn.xzkj.erp.order.domain.SkuMatchQueueItem(
                        o.id, o.version, o.status, o.shopId, o.externalOrderRef, o.placedAt,
                        l.id, l.externalLineRef, l.titleSnapshot, l.externalListingRef,
                        l.externalVariantRef, l.skuId, l.skuMatchSource
                    )
                    from TenantOrder o
                    join OrderLine l on l.tenantId = o.tenantId and l.orderId = o.id
                    where o.tenantId = :tenantId
                      and l.tenantId = :tenantId
                      and l.orderId = o.id
                      and o.status in (
                          cn.xzkj.erp.order.domain.OrderStatus.RECEIVED,
                          cn.xzkj.erp.order.domain.OrderStatus.REVIEW_PENDING,
                          cn.xzkj.erp.order.domain.OrderStatus.HOLD
                      )
                      and l.skuId is null
                      and (:shopId is null or o.shopId = :shopId)
                      and (
                          :keywordPresent = false
                          or locate(:keyword, lower(o.externalOrderRef)) > 0
                          or locate(:keyword, lower(l.externalLineRef)) > 0
                          or locate(:keyword, lower(l.titleSnapshot)) > 0
                      )
                    order by o.placedAt asc, o.id asc, l.externalLineRef asc, l.id asc
                    """,
            countQuery = """
                    select count(l)
                    from TenantOrder o
                    join OrderLine l on l.tenantId = o.tenantId and l.orderId = o.id
                    where o.tenantId = :tenantId
                      and l.tenantId = :tenantId
                      and l.orderId = o.id
                      and o.status in (
                          cn.xzkj.erp.order.domain.OrderStatus.RECEIVED,
                          cn.xzkj.erp.order.domain.OrderStatus.REVIEW_PENDING,
                          cn.xzkj.erp.order.domain.OrderStatus.HOLD
                      )
                      and l.skuId is null
                      and (:shopId is null or o.shopId = :shopId)
                      and (
                          :keywordPresent = false
                          or locate(:keyword, lower(o.externalOrderRef)) > 0
                          or locate(:keyword, lower(l.externalLineRef)) > 0
                          or locate(:keyword, lower(l.titleSnapshot)) > 0
                      )
                    """
    )
    Page<SkuMatchQueueItem> searchSkuMatchQueue(
            @Param("tenantId") UUID tenantId,
            @Param("shopId") UUID shopId,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable);

    /*
     * The requested-shop ownership check and every aggregate share this single
     * statement. Both sides of the order/line join retain an explicit tenant
     * predicate, while sku_id IS NULL remains eligible for the V32 partial index.
     */
    @Query(value = """
            with requested_shop as (
                select (
                    cast(:shopId as uuid) is null
                    or exists (
                        select 1
                        from tenant_shops s
                        where s.tenant_id = cast(:tenantId as uuid)
                          and s.id = cast(:shopId as uuid)
                    )
                ) as shop_exists
            ),
            scoped_orders as materialized (
                select o.id, o.status, o.placed_at
                from tenant_orders o
                where o.tenant_id = cast(:tenantId as uuid)
                  and (
                      cast(:shopId as uuid) is null
                      or o.shop_id = cast(:shopId as uuid)
                  )
            ),
            order_counts as (
                select
                    count(*) as total_orders,
                    count(*) filter (where status = 'UNPAID') as unpaid_orders,
                    count(*) filter (where status = 'RECEIVED') as received_orders,
                    count(*) filter (where status = 'REVIEW_PENDING') as review_pending_orders,
                    count(*) filter (where status = 'MERGE_PENDING') as merge_pending_orders,
                    count(*) filter (where status = 'HOLD') as hold_orders,
                    count(*) filter (where status = 'READY_TO_FULFILL') as ready_to_fulfill_orders,
                    count(*) filter (where status = 'FULFILLING') as fulfilling_orders,
                    count(*) filter (where status = 'SHIPPED') as shipped_orders,
                    count(*) filter (where status = 'DELIVERED') as delivered_orders,
                    count(*) filter (where status = 'CANCELLED') as cancelled_orders,
                    count(*) filter (
                        where status in (
                            'UNPAID', 'RECEIVED', 'REVIEW_PENDING',
                            'MERGE_PENDING', 'HOLD'
                        )
                    ) as editable_orders
                from scoped_orders
            ),
            unmatched as (
                select
                    count(l.id) as unmatched_lines,
                    min(o.placed_at) as oldest_unmatched_placed_at
                from scoped_orders o
                join tenant_order_lines l
                  on l.tenant_id = cast(:tenantId as uuid)
                 and l.order_id = o.id
                where o.status in (
                    'UNPAID', 'RECEIVED', 'REVIEW_PENDING',
                    'MERGE_PENDING', 'HOLD'
                )
                  and l.sku_id is null
            )
            select
                rs.shop_exists as "shopExists",
                oc.total_orders as "totalOrders",
                oc.unpaid_orders as "unpaidOrders",
                oc.received_orders as "receivedOrders",
                oc.review_pending_orders as "reviewPendingOrders",
                oc.merge_pending_orders as "mergePendingOrders",
                oc.hold_orders as "holdOrders",
                oc.ready_to_fulfill_orders as "readyToFulfillOrders",
                oc.fulfilling_orders as "fulfillingOrders",
                oc.shipped_orders as "shippedOrders",
                oc.delivered_orders as "deliveredOrders",
                oc.cancelled_orders as "cancelledOrders",
                oc.editable_orders as "editableOrders",
                u.unmatched_lines as "unmatchedLines",
                u.oldest_unmatched_placed_at as "oldestUnmatchedPlacedAt"
            from requested_shop rs
            cross join order_counts oc
            cross join unmatched u
            """, nativeQuery = true)
    DashboardSummaryProjection summarizeDashboard(
            @Param("tenantId") UUID tenantId,
            @Param("shopId") UUID shopId);

    interface DashboardSummaryProjection {
        boolean getShopExists();
        long getTotalOrders();
        long getUnpaidOrders();
        long getReceivedOrders();
        long getReviewPendingOrders();
        long getMergePendingOrders();
        long getHoldOrders();
        long getReadyToFulfillOrders();
        long getFulfillingOrders();
        long getShippedOrders();
        long getDeliveredOrders();
        long getCancelledOrders();
        long getEditableOrders();
        long getUnmatchedLines();
        Instant getOldestUnmatchedPlacedAt();
    }
}
