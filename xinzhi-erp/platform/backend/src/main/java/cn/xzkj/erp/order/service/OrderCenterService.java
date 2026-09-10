package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.CREATED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.LINE_SKU_MATCHED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.LINE_SKU_UNMATCHED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.PROFILE_UPDATED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.PROTECTED_CUSTOMER_DATA_READ;
import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_SHIPPING_ADDRESS_UPDATED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.STATUS_CHANGED;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.order.domain.BuyerReferenceSanitizer;
import cn.xzkj.erp.order.domain.OrderDashboardSummary;
import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderActivity;
import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.SkuMatchQueueItem;
import cn.xzkj.erp.order.domain.SkuMatchSource;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.OrderAggregateVersionLock;
import cn.xzkj.erp.order.repository.OrderLineRepository;
import cn.xzkj.erp.order.repository.OrderIdempotencyLock;
import cn.xzkj.erp.order.repository.OrderListingLookupRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.PageResult;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.Query;
import cn.xzkj.erp.order.repository.OrderRepository;
import cn.xzkj.erp.order.repository.OrderProfileStore;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.settings.deadline.ShippingDeadlineSettingService;

@Service
public class OrderCenterService {
    private final OrderRepository orderRepository;
    private final OrderIdempotencyLock idempotencyLock;
    private final OrderAggregateVersionLock aggregateVersionLock;
    private final OrderLineRepository lineRepository;
    private final OrderSkuLookupRepository skuRepository;
    private final OrderListingLookupRepository listingRepository;
    private final TenantShopRepository shopRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final OrderListQueryRepository listQueryRepository;
    private final WarehouseScopeEvaluator scopeEvaluator;
    private final OrderProfileStore profileStore;
    private final ShippingDeadlineSettingService shippingDeadlineSettingService;

    @Autowired
    public OrderCenterService(OrderRepository orderRepository, OrderIdempotencyLock idempotencyLock,
            OrderAggregateVersionLock aggregateVersionLock, OrderLineRepository lineRepository,
            OrderSkuLookupRepository skuRepository, OrderListingLookupRepository listingRepository,
            TenantShopRepository shopRepository,
            SecurityAuditRecorder auditRecorder,
            OrderListQueryRepository listQueryRepository,
            WarehouseScopeEvaluator scopeEvaluator,
            OrderProfileStore profileStore,
            ShippingDeadlineSettingService shippingDeadlineSettingService) {
        this.orderRepository = orderRepository;
        this.idempotencyLock = idempotencyLock;
        this.aggregateVersionLock = aggregateVersionLock;
        this.lineRepository = lineRepository;
        this.skuRepository = skuRepository;
        this.listingRepository = listingRepository;
        this.shopRepository = shopRepository;
        this.auditRecorder = auditRecorder;
        this.listQueryRepository = listQueryRepository;
        this.scopeEvaluator = scopeEvaluator;
        this.profileStore = profileStore;
        this.shippingDeadlineSettingService = shippingDeadlineSettingService;
    }

    OrderCenterService(OrderRepository orderRepository,
            OrderIdempotencyLock idempotencyLock,
            OrderAggregateVersionLock aggregateVersionLock,
            OrderLineRepository lineRepository,
            OrderSkuLookupRepository skuRepository,
            OrderListingLookupRepository listingRepository,
            TenantShopRepository shopRepository,
            SecurityAuditRecorder auditRecorder,
            OrderListQueryRepository listQueryRepository,
            WarehouseScopeEvaluator scopeEvaluator,
            OrderProfileStore profileStore) {
        this(orderRepository, idempotencyLock, aggregateVersionLock,
                lineRepository, skuRepository, listingRepository,
                shopRepository, auditRecorder, listQueryRepository,
                scopeEvaluator, profileStore, null);
    }

    OrderCenterService(
            OrderRepository orderRepository,
            OrderIdempotencyLock idempotencyLock,
            OrderAggregateVersionLock aggregateVersionLock,
            OrderLineRepository lineRepository,
            OrderSkuLookupRepository skuRepository,
            OrderListingLookupRepository listingRepository,
            TenantShopRepository shopRepository,
            SecurityAuditRecorder auditRecorder) {
        this(
                orderRepository, idempotencyLock, aggregateVersionLock,
                lineRepository, skuRepository, listingRepository,
                shopRepository, auditRecorder, null, null, null, null);
    }

    @Transactional
    public OrderAggregate createOrder(OrderActor actor, CreateOrderCommand command) {
        NormalizedOrder normalized = normalize(command);
        String fingerprint = fingerprint(normalized);
        idempotencyLock.acquire(actor.tenantId(), normalized.idempotencyKey());
        var replay = orderRepository.findByTenantIdAndIdempotencyKey(actor.tenantId(), normalized.idempotencyKey());
        if (replay.isPresent()) {
            if (!replay.get().getRequestFingerprint().equals(fingerprint)) {
                throw new ConflictException("Idempotency key is already used");
            }
            return aggregate(actor.tenantId(), replay.get());
        }

        requireShop(actor.tenantId(), normalized.shopId());
        if (normalized.warehouseId() != null) {
            if (!listQueryRepository.warehouseExists(
                    actor.tenantId(), normalized.warehouseId())) {
                throw new ResourceNotFoundException("Warehouse was not found");
            }
            scopeEvaluator.requireVisible(scope(actor), normalized.warehouseId());
        } else if (!scope(actor).allowsAll()) {
            throw new ResourceNotFoundException("Warehouse was not found");
        }
        if (profileStore != null && !profileStore.referencesAreTenantOwned(
                actor.tenantId(), normalized.warehouseId(),
                normalized.profile())) {
            throw new ResourceNotFoundException(
                    "Order profile reference was not found");
        }
        requireTenantSkus(actor.tenantId(), normalized.lines());
        List<ResolvedLine> resolvedLines = resolveSkuMatches(actor.tenantId(), normalized.shopId(), normalized.lines());
        TenantOrder order = new TenantOrder(actor.tenantId(), normalized.shopId(), normalized.externalOrderRef(),
                normalized.idempotencyKey(), fingerprint, normalized.currency(), normalized.buyerReference(),
                normalized.lines().size(), normalized.placedAt());
        TenantOrder.OperationalMetadata operational = normalized.operational();
        if (shippingDeadlineSettingService != null) {
            Instant baseline = operational.paidAt() == null
                    ? normalized.placedAt() : operational.paidAt();
            operational = operational.withShipByAt(
                    shippingDeadlineSettingService.resolveShipByAt(
                            actor.tenantId(), baseline, operational.shipByAt()));
        }
        order.applyOperationalMetadata(operational);
        try {
            order = orderRepository.saveAndFlush(order);
            UUID orderId = order.getId();
            List<OrderLine> lines = resolvedLines.stream()
                    .map(resolved -> new OrderLine(actor.tenantId(), orderId, resolved.skuId(),
                            resolved.line().externalListingRef(), resolved.line().externalVariantRef(),
                            resolved.source(), resolved.line().externalLineRef(), resolved.line().titleSnapshot(),
                            resolved.line().quantity(), resolved.line().unitPriceMinor(), resolved.line().currency()))
                    .toList();
            lines = lineRepository.saveAllAndFlush(lines);
            if (profileStore != null) {
                profileStore.insert(
                        actor.tenantId(), orderId, normalized.profile());
                profileStore.appendActivity(
                        actor.tenantId(), orderId, "ORDER_CREATED",
                        "订单已在 ERP 本地创建。", actor.userId(),
                        actor.systemAdminId(), actor.requestId());
            }
            audit(actor, CREATED, order, Map.of(
                    "automaticMatchCount", Long.toString(resolvedLines.stream()
                            .filter(line -> line.source() == SkuMatchSource.LISTING_MAPPING).count()),
                    "unmatchedCount", Long.toString(resolvedLines.stream()
                            .filter(line -> line.source() == SkuMatchSource.UNMATCHED).count())));
            return new OrderAggregate(
                    order, lines, skuBusinessCodes(actor.tenantId(), lines));
        } catch (DataIntegrityViolationException conflict) {
            throw new ConflictException("Order conflicts with existing data");
        }
    }

    @Transactional(readOnly = true)
    public Page<TenantOrder> listOrders(UUID tenantId, UUID shopId, OrderStatus status,
            String keyword, Pageable pageable) {
        requireTenant(tenantId);
        if (shopId != null) {
            requireShop(tenantId, shopId);
        }
        String normalizedKeyword = trimNullable(keyword);
        return orderRepository.searchByTenantId(
                tenantId, shopId, status, normalizedKeyword != null,
                normalizedKeyword == null ? "" : normalizedKeyword.toLowerCase(Locale.ROOT), pageable);
    }

    @Transactional(readOnly = true)
    public PageResult searchOrders(
            OrderActor actor, Query query, int page, int size) {
        requireActor(actor);
        WarehouseScopeAccess scope = scope(actor);
        if (query.warehouseId() != null) {
            scopeEvaluator.requireVisible(scope, query.warehouseId());
        }
        return listQueryRepository.search(
                actor.tenantId(), query, page, size,
                scope.allowsAll(), scope.warehouseIds());
    }

    @Transactional(readOnly = true)
    public Page<SkuMatchQueueItem> listSkuMatchQueue(OrderActor actor, UUID shopId,
            String keyword, Pageable pageable) {
        requireActor(actor);
        UUID tenantId = actor.tenantId();
        if (shopId != null) {
            requireShop(tenantId, shopId);
        }
        String normalizedKeyword = trimNullable(keyword);
        if (normalizedKeyword != null && normalizedKeyword.length() > 100) {
            throw new IllegalArgumentException("Keyword is too long");
        }
        WarehouseScopeAccess scope = scope(actor);
        var result = listQueryRepository.searchSkuMatchQueue(
                tenantId, shopId, normalizedKeyword, pageable.getPageNumber(),
                pageable.getPageSize(), scope.allowsAll(), scope.warehouseIds());
        return new PageImpl<>(result.items(), pageable, result.totalElements());
    }

    @Transactional(readOnly = true)
    public Page<SkuMatchQueueItem> listSkuMatchQueue(
            UUID tenantId, UUID shopId, String keyword,
            Pageable pageable) {
        requireTenant(tenantId);
        if (shopId != null) {
            requireShop(tenantId, shopId);
        }
        String normalizedKeyword = trimNullable(keyword);
        if (normalizedKeyword != null && normalizedKeyword.length() > 100) {
            throw new IllegalArgumentException("Keyword is too long");
        }
        return orderRepository.searchSkuMatchQueue(
                tenantId, shopId, normalizedKeyword != null,
                normalizedKeyword == null
                        ? "" : normalizedKeyword.toLowerCase(Locale.ROOT),
                pageable);
    }

    @Transactional(readOnly = true)
    public OrderDashboardSummary dashboardSummary(
            OrderActor actor, UUID shopId) {
        requireActor(actor);
        if (shopId != null) {
            requireShop(actor.tenantId(), shopId);
        }
        WarehouseScopeAccess scope = scope(actor);
        var projection = listQueryRepository.summarize(
                actor.tenantId(), shopId,
                scope.allowsAll(), scope.warehouseIds());
        return new OrderDashboardSummary(
                projection.totalOrders(),
                projection.unpaidOrders(),
                projection.receivedOrders(),
                projection.reviewPendingOrders(),
                projection.mergePendingOrders(),
                projection.holdOrders(),
                projection.readyToFulfillOrders(),
                projection.fulfillingOrders(),
                projection.shippedOrders(),
                projection.deliveredOrders(),
                projection.cancelledOrders(),
                projection.editableOrders(),
                projection.unmatchedLines(),
                projection.oldestUnmatchedPlacedAt());
    }

    /**
     * Internal compatibility entry point. Web request paths must pass the
     * authenticated actor so warehouse scope cannot be bypassed.
     */
    public OrderDashboardSummary dashboardSummary(
            UUID tenantId, UUID shopId) {
        requireTenant(tenantId);
        var projection = orderRepository.summarizeDashboard(
                tenantId, shopId);
        if (!projection.getShopExists()) {
            throw new ResourceNotFoundException("Shop was not found");
        }
        return new OrderDashboardSummary(
                projection.getTotalOrders(),
                projection.getUnpaidOrders(),
                projection.getReceivedOrders(),
                projection.getReviewPendingOrders(),
                projection.getMergePendingOrders(),
                projection.getHoldOrders(),
                projection.getReadyToFulfillOrders(),
                projection.getFulfillingOrders(),
                projection.getShippedOrders(),
                projection.getDeliveredOrders(),
                projection.getCancelledOrders(),
                projection.getEditableOrders(),
                projection.getUnmatchedLines(),
                projection.getOldestUnmatchedPlacedAt());
    }

    @Transactional(readOnly = true)
    public OrderAggregate getOrder(OrderActor actor, UUID orderId) {
        requireActor(actor);
        OrderAggregate aggregate =
                aggregate(actor.tenantId(), requireOrder(actor.tenantId(), orderId));
        requireVisible(actor, aggregate);
        auditProtectedCustomerDataRead(actor, aggregate.order());
        return aggregate;
    }

    @Transactional(readOnly = true)
    public OrderAggregate getOrder(UUID tenantId, UUID orderId) {
        return aggregate(tenantId, requireOrder(tenantId, orderId));
    }

    @Transactional
    public OrderAggregate changeStatus(OrderActor actor, UUID orderId, long expectedVersion,
            OrderStatus targetStatus, String reason) {
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        if (order.getVersion() != expectedVersion) {
            throw new ConflictException("Order version is stale");
        }
        String safeReason = truncate(trimNullable(SensitiveTextRedactor.redactNullable(reason)), 500);
        if (targetStatus == OrderStatus.FULFILLING
                || targetStatus == OrderStatus.SHIPPED) {
            throw new ConflictException(
                    "Fulfillment-owned order status cannot be set directly");
        }
        if (targetStatus == OrderStatus.READY_TO_FULFILL
                && lineRepository.hasUnmatchedLine(actor.tenantId(), orderId)) {
            throw new ConflictException("All order lines must be matched before fulfillment readiness");
        }
        OrderStatus previous = order.getStatus();
        boolean changed = order.transition(targetStatus, safeReason);
        if (changed) {
            order = orderRepository.saveAndFlush(order);
            audit(actor, STATUS_CHANGED, order, Map.of(
                    "fromStatus", previous.name(),
                    "toStatus", targetStatus.name()));
        }
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate changeLineSkuMatch(OrderActor actor, UUID orderId, UUID lineId,
            long expectedVersion, UUID targetSkuId) {
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        OrderLine line = lineRepository.findByIdAndTenantIdAndOrderId(lineId, actor.tenantId(), orderId)
                .orElseThrow(() -> new ResourceNotFoundException("Order line was not found"));
        if (order.getVersion() != expectedVersion) {
            throw new ConflictException("Order version is stale");
        }
        if (line.getLineKind()
                == cn.xzkj.erp.order.domain.OrderLineKind.CUSTOM_AMOUNT) {
            throw new ConflictException(
                    "Custom amount lines do not use SKU matching");
        }
        if (order.getStatus() == OrderStatus.READY_TO_FULFILL
                || order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException("Order lines cannot be changed in the current status");
        }
        if (targetSkuId != null) {
            requireSku(actor.tenantId(), targetSkuId);
        }
        SkuMatchSource targetSource = targetSkuId == null
                ? SkuMatchSource.UNMATCHED : SkuMatchSource.MANUAL;
        SkuMatchSource previousSource = line.getSkuMatchSource();
        if (!line.updateSkuMatch(targetSkuId, targetSource)) {
            return aggregate(actor.tenantId(), order);
        }
        lineRepository.saveAndFlush(line);
        aggregateVersionLock.forceIncrement(order);
        auditLineMatch(actor, targetSkuId == null ? LINE_SKU_UNMATCHED : LINE_SKU_MATCHED,
                order, line, previousSource, targetSource);
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyLineQuantityUpdate(
            OrderActor actor,
            UUID shopId,
            UUID orderId,
            UUID lineId,
            String externalOrderRef,
            String externalLineRef,
            String externalVariantRef,
            int expectedQuantity,
            int quantity,
            long totalAmountMinor,
            String currency) {
        requireActor(actor);
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        OrderLine line = lineRepository
                .findByIdAndTenantIdAndOrderId(
                        lineId, actor.tenantId(), orderId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Order line was not found"));
        if (!order.getShopId().equals(shopId)
                || !order.getExternalOrderRef().equals(externalOrderRef)
                || !line.getExternalLineRef().equals(externalLineRef)
                || !Objects.equals(
                        line.getExternalVariantRef(), externalVariantRef)) {
            throw new ConflictException(
                    "Shopify order line mapping changed");
        }
        if (order.getStatus() == OrderStatus.READY_TO_FULFILL
                || order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order lines cannot be changed in the current status");
        }
        if (!order.getCurrency().equals(currency)
                || !line.getCurrency().equals(currency)
                || totalAmountMinor < 0) {
            throw new ConflictException(
                    "Shopify order total is invalid");
        }
        int previousQuantity = line.getQuantity();
        if (previousQuantity != expectedQuantity
                && previousQuantity != quantity) {
            throw new ConflictException(
                    "Order line quantity changed concurrently");
        }
        boolean lineChanged = line.updateQuantity(quantity);
        boolean totalChanged = !Objects.equals(
                order.getTotalAmountMinor(), totalAmountMinor);
        if (lineChanged) {
            lineRepository.saveAndFlush(line);
        }
        if (totalChanged) {
            order.applyOperationalMetadata(
                    order.operationalMetadata()
                            .withTotalAmount(totalAmountMinor));
            orderRepository.saveAndFlush(order);
        }
        if (lineChanged || totalChanged) {
            aggregateVersionLock.forceIncrement(order);
        }
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyVariantAddition(
            OrderActor actor,
            UUID shopId,
            UUID orderId,
            UUID listingId,
            UUID skuId,
            String externalOrderRef,
            String externalListingRef,
            String externalVariantRef,
            String externalLineRef,
            String platformSku,
            String title,
            int quantity,
            long unitPriceMinor,
            long totalAmountMinor,
            String currency) {
        requireActor(actor);
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        if (!order.getShopId().equals(shopId)
                || !order.getExternalOrderRef().equals(externalOrderRef)) {
            throw new ConflictException("Shopify order mapping changed");
        }
        if (order.getStatus() == OrderStatus.READY_TO_FULFILL
                || order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order lines cannot be changed in the current status");
        }
        ProductListing listing = listingRepository
                .findByIdAndTenantIdAndShopIdAndStatus(
                        listingId, actor.tenantId(), shopId,
                        ListingStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product listing was not found"));
        var sku = skuRepository.findByIdAndTenantId(
                        skuId, actor.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product SKU was not found"));
        if (!listing.getSkuId().equals(skuId)
                || !Objects.equals(
                        listing.getExternalListingRef(),
                        externalListingRef)
                || !Objects.equals(
                        listing.getExternalVariantRef(), externalVariantRef)
                || !sku.getBusinessCode().equals(platformSku)) {
            throw new ConflictException(
                    "Shopify product listing mapping changed");
        }
        if (lineRepository.existsByTenantIdAndOrderIdAndExternalVariantRef(
                actor.tenantId(), orderId, externalVariantRef)) {
            throw new ConflictException(
                    "Shopify order already contains this variant");
        }
        if (!order.getCurrency().equals(currency)
                || quantity < 1 || quantity > 100_000
                || unitPriceMinor < 0 || totalAmountMinor < 0
                || title == null || title.isBlank()
                || title.length() > 300) {
            throw new ConflictException(
                    "Shopify added order line is invalid");
        }
        OrderLine line = new OrderLine(
                actor.tenantId(), orderId, skuId,
                externalListingRef, externalVariantRef,
                SkuMatchSource.PROVIDED, externalLineRef,
                title.strip(), quantity, unitPriceMinor, currency);
        line.applyOperationalMetadata(
                platformSku, sku.getDefaultWarehouseId(), null, null);
        line = lineRepository.saveAndFlush(line);
        order.incrementLineCount();
        order.applyOperationalMetadata(
                order.operationalMetadata().withTotalAmount(totalAmountMinor));
        orderRepository.saveAndFlush(order);
        aggregateVersionLock.forceIncrement(order);
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyCustomItemAddition(
            OrderActor actor,
            UUID shopId,
            UUID orderId,
            String externalOrderRef,
            String externalLineRef,
            String title,
            int quantity,
            long unitPriceMinor,
            long totalAmountMinor,
            String currency) {
        requireActor(actor);
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        if (!order.getShopId().equals(shopId)
                || !order.getExternalOrderRef().equals(externalOrderRef)) {
            throw new ConflictException("Shopify order mapping changed");
        }
        if (order.getStatus() == OrderStatus.READY_TO_FULFILL
                || order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order lines cannot be changed in the current status");
        }
        if (lineRepository.existsByTenantIdAndOrderIdAndExternalLineRef(
                actor.tenantId(), orderId, externalLineRef)) {
            throw new ConflictException(
                    "Shopify order already contains this custom item");
        }
        if (!order.getCurrency().equals(currency)
                || quantity < 1 || quantity > 100_000
                || unitPriceMinor < 0 || totalAmountMinor < 0
                || title == null || title.isBlank()
                || title.length() > 255) {
            throw new ConflictException(
                    "Shopify custom order item is invalid");
        }
        OrderLine line = OrderLine.customAmount(
                actor.tenantId(), orderId, externalLineRef,
                title.strip(), quantity, unitPriceMinor, currency);
        lineRepository.saveAndFlush(line);
        order.incrementLineCount();
        order.applyOperationalMetadata(
                order.operationalMetadata().withTotalAmount(totalAmountMinor));
        orderRepository.saveAndFlush(order);
        aggregateVersionLock.forceIncrement(order);
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyOrderLineDiscount(
            OrderActor actor,
            UUID shopId,
            UUID orderId,
            String externalOrderRef,
            UUID lineId,
            String externalLineRef,
            long expectedDiscountTotalMinor,
            long discountTotalMinor,
            String discountDescription,
            long totalAmountMinor,
            String currency) {
        requireActor(actor);
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        requireVisible(actor, aggregate(actor.tenantId(), order));
        if (!order.getShopId().equals(shopId)
                || !order.getExternalOrderRef().equals(externalOrderRef)) {
            throw new ConflictException("Shopify order mapping changed");
        }
        if (order.getStatus() == OrderStatus.READY_TO_FULFILL
                || order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order lines cannot be changed in the current status");
        }
        OrderLine line = lineRepository
                .findByIdAndTenantIdAndOrderId(
                        lineId, actor.tenantId(), orderId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Order line was not found"));
        if (line.getLineKind()
                    != cn.xzkj.erp.order.domain.OrderLineKind.PRODUCT
                || !Objects.equals(
                        line.getExternalLineRef(), externalLineRef)
                || !order.getCurrency().equals(currency)
                || totalAmountMinor < 0) {
            throw new ConflictException(
                    "Shopify order line discount mapping changed");
        }
        try {
            line.applyShopifyDiscount(
                    expectedDiscountTotalMinor,
                    discountTotalMinor,
                    discountDescription);
        } catch (IllegalArgumentException exception) {
            throw new ConflictException(
                    "Shopify order line discount state changed");
        }
        lineRepository.saveAndFlush(line);
        order.applyOperationalMetadata(
                order.operationalMetadata().withTotalAmount(totalAmountMinor));
        orderRepository.saveAndFlush(order);
        aggregateVersionLock.forceIncrement(order);
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate updateProfile(
            OrderActor actor, UUID orderId, long expectedVersion,
            long expectedProfileVersion, UUID warehouseId,
            TenantOrder.OperationalMetadata requestedOperational,
            OrderProfile requestedProfile) {
        requireActor(actor);
        TenantOrder order =
                requireOrderForUpdate(actor.tenantId(), orderId);
        OrderAggregate current = aggregate(actor.tenantId(), order);
        requireVisible(actor, current);
        if (order.getVersion() != expectedVersion) {
            throw new ConflictException("Order version is stale");
        }
        if (warehouseId != null) {
            if (!listQueryRepository.warehouseExists(
                    actor.tenantId(), warehouseId)) {
                throw new ResourceNotFoundException(
                        "Warehouse was not found");
            }
            scopeEvaluator.requireVisible(scope(actor), warehouseId);
        } else if (!scope(actor).allowsAll()) {
            throw new ResourceNotFoundException("Warehouse was not found");
        }
        OrderProfile profile = normalizeProfile(requestedProfile);
        if (!profileStore.referencesAreTenantOwned(
                actor.tenantId(), warehouseId, profile)) {
            throw new ResourceNotFoundException(
                    "Order profile reference was not found");
        }
        order.applyOperationalMetadata(
                normalizeOperational(requestedOperational, warehouseId));
        orderRepository.saveAndFlush(order);
        if (!profileStore.update(
                actor.tenantId(), orderId, expectedProfileVersion, profile)) {
            throw new ConflictException("Order profile version is stale");
        }
        profileStore.appendActivity(
                actor.tenantId(), orderId, "ORDER_PROFILE_UPDATED",
                "订单资料已更新。", actor.userId(), actor.systemAdminId(),
                actor.requestId());
        audit(actor, PROFILE_UPDATED, order, Map.of(
                "profileVersion",
                Long.toString(expectedProfileVersion + 1)));
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyShippingAddressUpdate(
            OrderActor actor,
            UUID orderId,
            long expectedVersion,
            long expectedProfileVersion,
            TenantOrder.OperationalMetadata requestedOperational,
            OrderProfile requestedProfile,
            String idempotencyKey) {
        requireActor(actor);
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        OrderAggregate current = aggregate(actor.tenantId(), order);
        requireVisible(actor, current);
        if (order.getVersion() != expectedVersion) {
            throw new ConflictException("Order version is stale");
        }
        if (order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED
                || order.getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Shopify shipping address cannot be changed after fulfillment starts");
        }
        UUID warehouseId = requestedOperational.warehouseId();
        if (warehouseId != null) {
            if (!listQueryRepository.warehouseExists(
                    actor.tenantId(), warehouseId)) {
                throw new ResourceNotFoundException(
                        "Warehouse was not found");
            }
            scopeEvaluator.requireVisible(scope(actor), warehouseId);
        } else if (!scope(actor).allowsAll()) {
            throw new ResourceNotFoundException("Warehouse was not found");
        }
        OrderProfile profile = normalizeProfile(requestedProfile);
        if (!profileStore.referencesAreTenantOwned(
                actor.tenantId(), warehouseId, profile)) {
            throw new ResourceNotFoundException(
                    "Order profile reference was not found");
        }
        order.applyOperationalMetadata(
                normalizeOperational(requestedOperational, warehouseId));
        orderRepository.saveAndFlush(order);
        if (!profileStore.update(
                actor.tenantId(), orderId, expectedProfileVersion, profile)) {
            throw new ConflictException("Order profile version is stale");
        }
        profileStore.appendActivity(
                actor.tenantId(), orderId,
                "SHOPIFY_SHIPPING_ADDRESS_UPDATED",
                "Shopify shipping address synchronized",
                actor.userId(), actor.systemAdminId(), actor.requestId());
        audit(actor, SHOPIFY_SHIPPING_ADDRESS_UPDATED, order, Map.of(
                "idempotencyKey", required(idempotencyKey),
                "profileVersion", Long.toString(expectedProfileVersion + 1)));
        return aggregate(actor.tenantId(), order);
    }

    @Transactional
    public OrderAggregate applyShopifyCancellation(
            OrderActor actor, UUID shopId, UUID orderId,
            String externalOrderRef, long expectedVersion,
            long expectedProfileVersion, Instant cancelledAt) {
        requireActor(actor);
        if (cancelledAt == null) {
            throw new IllegalArgumentException("Cancellation time is required");
        }
        TenantOrder order = requireOrderForUpdate(actor.tenantId(), orderId);
        OrderAggregate current = aggregate(actor.tenantId(), order);
        requireVisible(actor, current);
        if (!order.getShopId().equals(shopId)
                || !order.getExternalOrderRef().equals(externalOrderRef)
                || order.getVersion() != expectedVersion
                || current.profile().version() != expectedProfileVersion) {
            throw new ConflictException("Shopify order mapping changed");
        }
        if (order.getStatus() == OrderStatus.FULFILLING
                || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED) {
            throw new ConflictException(
                    "Shopify order cannot be cancelled after fulfillment starts");
        }
        if (order.getStatus() != OrderStatus.CANCELLED) {
            order.transition(OrderStatus.CANCELLED, null);
            orderRepository.saveAndFlush(order);
        }
        if (!profileStore.update(actor.tenantId(), orderId,
                expectedProfileVersion,
                current.profile().withCancelledAt(cancelledAt))) {
            throw new ConflictException("Order profile version is stale");
        }
        profileStore.appendActivity(
                actor.tenantId(), orderId, "SHOPIFY_ORDER_CANCELLED",
                "Shopify order cancellation synchronized",
                actor.userId(), actor.systemAdminId(), actor.requestId());
        return aggregate(actor.tenantId(), order);
    }

    private NormalizedOrder normalize(CreateOrderCommand command) {
        if (command.lines() == null || command.lines().isEmpty() || command.lines().size() > 200) {
            throw new IllegalArgumentException("Order lines are invalid");
        }
        String currency = required(command.currency()).toUpperCase(Locale.ROOT);
        Set<String> externalRefs = new HashSet<>();
        List<NormalizedLine> lines = command.lines().stream().map(line -> {
            String externalRef = required(line.externalLineRef());
            if (!externalRefs.add(externalRef)) {
                throw new IllegalArgumentException("Order line references must be unique");
            }
            String lineCurrency = required(line.currency()).toUpperCase(Locale.ROOT);
            if (!currency.equals(lineCurrency) || line.quantity() <= 0 || line.unitPriceMinor() < 0) {
                throw new IllegalArgumentException("Order line values are invalid");
            }
            String titleFingerprintSource = required(line.titleSnapshot());
            String externalListingRef = trimNullable(line.externalListingRef());
            String externalVariantRef = trimNullable(line.externalVariantRef());
            if (externalVariantRef != null && externalListingRef == null) {
                throw new IllegalArgumentException("External variant reference requires a listing reference");
            }
            return new NormalizedLine(line.skuId(), externalListingRef, externalVariantRef, externalRef,
                    truncate(required(SensitiveTextRedactor.redactNullable(titleFingerprintSource)), 300),
                    titleFingerprintSource, line.quantity(), line.unitPriceMinor(), lineCurrency);
        }).sorted(Comparator.comparing(NormalizedLine::externalLineRef)).toList();
        String buyerFingerprintSource = trimNullable(command.buyerReference());
        return new NormalizedOrder(command.shopId(), required(command.externalOrderRef()),
                required(command.idempotencyKey()), currency,
                BuyerReferenceSanitizer.sanitize(buyerFingerprintSource), buyerFingerprintSource,
                Objects.requireNonNull(command.placedAt(), "placedAt"),
                command.warehouseId(),
                normalizeOperational(command.operational(),
                        command.warehouseId()),
                normalizeProfile(command.profile()),
                lines);
    }

    private static TenantOrder.OperationalMetadata normalizeOperational(
            TenantOrder.OperationalMetadata value, UUID warehouseId) {
        TenantOrder.OperationalMetadata source = value == null
                ? new TenantOrder.OperationalMetadata(
                        null, null, null, null, null, null, null,
                        null, null, null, null, null, null, null,
                        null, null, warehouseId, false, null, false, false)
                : value;
        String paymentStatus = text(source.paymentStatus(), 32);
        if (paymentStatus != null && !Set.of(
                "UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED")
                .contains(paymentStatus)) {
            throw new IllegalArgumentException(
                    "Payment status is invalid");
        }
        String countryCode = text(source.countryCode(), 2);
        if (countryCode != null
                && !countryCode.matches("^[A-Z]{2}$")) {
            throw new IllegalArgumentException("Country code is invalid");
        }
        if (source.totalAmountMinor() != null
                && source.totalAmountMinor() < 0
                || source.shippingAmountMinor() != null
                && source.shippingAmountMinor() < 0
                || source.weightGrams() != null
                && source.weightGrams().signum() <= 0) {
            throw new IllegalArgumentException(
                    "Order operational amount is invalid");
        }
        String reshipmentReason = text(source.reshipmentReason(), 500);
        if (!source.reshipment() && reshipmentReason != null) {
            throw new IllegalArgumentException(
                    "Reshipment reason requires a reshipment");
        }
        return new TenantOrder.OperationalMetadata(
                text(source.platformStatus(), 64),
                paymentStatus,
                text(source.logisticsChannel(), 80),
                countryCode,
                text(source.province(), 120),
                text(source.postalCode(), 32),
                text(source.buyerSelectedLogistics(), 120),
                source.totalAmountMinor(),
                source.shippingAmountMinor(),
                source.weightGrams(),
                source.paidAt(),
                source.shipByAt(),
                source.shippedAt(),
                text(source.trackingStatus(), 32),
                text(source.fixedCategory(), 80),
                text(source.customCategory(), 80),
                warehouseId,
                source.reshipment(),
                reshipmentReason,
                source.platformHandoverRequired(),
                source.printed());
    }

    private void requireTenantSkus(UUID tenantId, List<NormalizedLine> lines) {
        Set<UUID> requested = lines.stream().map(NormalizedLine::skuId)
                .filter(Objects::nonNull).collect(java.util.stream.Collectors.toSet());
        if (!requested.isEmpty() && skuRepository.findAllByTenantIdAndIdIn(tenantId, requested).size() != requested.size()) {
            throw new ResourceNotFoundException("SKU was not found");
        }
    }

    private List<ResolvedLine> resolveSkuMatches(UUID tenantId, UUID shopId, List<NormalizedLine> lines) {
        Set<String> listingRefs = lines.stream()
                .filter(line -> line.skuId() == null && line.externalListingRef() != null)
                .map(NormalizedLine::externalListingRef)
                .collect(java.util.stream.Collectors.toSet());
        Map<ListingKey, List<ProductListing>> mappings = new HashMap<>();
        if (!listingRefs.isEmpty()) {
            listingRepository.findAllByTenantIdAndShopIdAndStatusAndExternalListingRefIn(
                            tenantId, shopId, ListingStatus.ACTIVE, listingRefs)
                    .stream()
                    .filter(listing -> tenantId.equals(listing.getTenantId())
                            && shopId.equals(listing.getShopId())
                            && listing.getStatus() == ListingStatus.ACTIVE)
                    .forEach(listing -> mappings.computeIfAbsent(
                                    new ListingKey(listing.getExternalListingRef(),
                                            trimNullable(listing.getExternalVariantRef())),
                                    ignored -> new java.util.ArrayList<>())
                            .add(listing));
        }
        return lines.stream().map(line -> {
            if (line.skuId() != null) {
                return new ResolvedLine(line, line.skuId(), SkuMatchSource.PROVIDED);
            }
            List<ProductListing> candidates = mappings.getOrDefault(
                    new ListingKey(line.externalListingRef(), line.externalVariantRef()), List.of());
            if (candidates.size() == 1) {
                return new ResolvedLine(line, candidates.getFirst().getSkuId(), SkuMatchSource.LISTING_MAPPING);
            }
            return new ResolvedLine(line, null, SkuMatchSource.UNMATCHED);
        }).toList();
    }

    private TenantOrder requireOrder(UUID tenantId, UUID orderId) {
        requireTenant(tenantId);
        return orderRepository.findByIdAndTenantId(orderId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Order was not found"));
    }

    private TenantOrder requireOrderForUpdate(UUID tenantId, UUID orderId) {
        requireTenant(tenantId);
        return orderRepository.findForUpdate(orderId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Order was not found"));
    }

    private void requireShop(UUID tenantId, UUID shopId) {
        requireTenant(tenantId);
        shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
    }

    private void requireSku(UUID tenantId, UUID skuId) {
        skuRepository.findByIdAndTenantId(skuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("SKU was not found"));
    }

    private OrderAggregate aggregate(UUID tenantId, TenantOrder order) {
        List<OrderLine> lines = lineRepository
                .findAllByTenantIdAndOrderIdOrderByExternalLineRef(
                        tenantId, order.getId());
        Map<UUID, String> skuBusinessCodes =
                skuBusinessCodes(tenantId, lines);
        if (profileStore == null) {
            return new OrderAggregate(order, lines, skuBusinessCodes);
        }
        return new OrderAggregate(
                order,
                profileStore.find(tenantId, order.getId())
                        .orElse(OrderProfile.empty()),
                profileStore.activities(tenantId, order.getId()),
                lines,
                skuBusinessCodes);
    }

    private Map<UUID, String> skuBusinessCodes(
            UUID tenantId, List<OrderLine> lines) {
        Set<UUID> skuIds = lines.stream()
                .map(OrderLine::getSkuId)
                .filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        if (skuIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> result = new HashMap<>();
        for (ProductSku sku :
                skuRepository.findAllByTenantIdAndIdIn(tenantId, skuIds)) {
            result.put(sku.getId(), sku.getBusinessCode());
        }
        return Map.copyOf(result);
    }

    private static OrderProfile normalizeProfile(OrderProfile value) {
        OrderProfile source = value == null ? OrderProfile.empty() : value;
        return new OrderProfile(
                text(source.salesRecordNumber(), 160),
                text(source.shoppingCartReference(), 160),
                text(source.customOrderReference(), 160),
                text(source.customerId(), 160),
                text(source.customerCode(), 160),
                text(source.recipientName(), 200),
                text(source.recipientPhone(), 40),
                lower(text(source.recipientEmail(), 254)),
                text(source.recipientCompany(), 200),
                text(source.addressLine1(), 300),
                text(source.addressLine2(), 300),
                text(source.city(), 120),
                text(source.district(), 120),
                text(source.town(), 120),
                text(source.doorCode(), 80),
                text(source.shippingService(), 120),
                text(source.trackingReference(), 160),
                text(source.secondaryTrackingReference(), 160),
                nonNegative(source.itemAmountMinor()),
                nonNegative(source.platformFeeMinor()),
                nonNegative(source.insuranceFeeMinor()),
                nonNegative(source.paymentFeeMinor()),
                nonNegative(source.otherIncomeMinor()),
                nonNegative(source.otherExpenseMinor()),
                nonNegative(source.actualPaidMinor()),
                source.profitMinor(),
                source.taxMinor(),
                nonNegative(source.estimatedShippingMinor()),
                nonNegative(source.actualShippingMinor()),
                text(source.platformMessage(), 1000),
                text(source.platformRemark(), 1000),
                text(source.orderRemark(), 1000),
                text(source.declarationPlan(), 1000),
                text(source.declarationActual(), 1000),
                text(source.customerCategory(), 80),
                positive(source.productKindCount()),
                source.locationId(),
                source.pickerUserId(),
                source.shipperUserId(),
                source.salespersonUserId(),
                source.purchaserUserId(),
                source.developerUserId(),
                source.managerUserId(),
                text(source.supplierReference(), 160),
                text(source.parentProductCategory(), 120),
                text(source.childProductCategory(), 120),
                text(source.productStatus(), 40),
                text(source.extendedAttribute(), 160),
                source.printedAt(),
                source.platformReturnedAt(),
                source.exceptionReviewedAt(),
                source.cancelledAt(),
                source.handedOverAt(),
                source.platformSpecifiedHandoverAt(),
                source.platformLabelRequestedAt(),
                source.deliveryDeadlineAt(),
                source.deliveredAt(),
                source.version(),
                source.createdAt(),
                source.updatedAt());
    }

    private static String text(String value, int max) {
        String normalized =
                trimNullable(SensitiveTextRedactor.redactNullable(value));
        if (normalized != null && normalized.length() > max) {
            throw new IllegalArgumentException("Order profile field is too long");
        }
        return normalized;
    }

    private static String lower(String value) {
        return value == null ? null : value.toLowerCase(Locale.ROOT);
    }

    private static Long nonNegative(Long value) {
        if (value != null && value < 0) {
            throw new IllegalArgumentException(
                    "Order amount cannot be negative");
        }
        return value;
    }

    private static Integer positive(Integer value) {
        if (value != null && value < 1) {
            throw new IllegalArgumentException(
                    "Product kind count must be positive");
        }
        return value;
    }

    private void requireVisible(OrderActor actor, OrderAggregate aggregate) {
        WarehouseScopeAccess scope = scope(actor);
        if (scope.allowsAll()) {
            return;
        }
        Set<UUID> warehouseIds = orderRepository.findWarehouseIds(
                actor.tenantId(), aggregate.order().getId());
        if (warehouseIds.isEmpty()) {
            throw new ResourceNotFoundException("Order was not found");
        }
        scopeEvaluator.requireAllVisible(scope, warehouseIds);
    }

    private WarehouseScopeAccess scope(OrderActor actor) {
        if (scopeEvaluator == null) {
            return new WarehouseScopeAccess(
                    cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode.ALL,
                    Set.of());
        }
        return scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
    }

    private void audit(OrderActor actor, String action, TenantOrder order, Map<String, String> details) {
        requireActor(actor);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "order", order.getId().toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private void auditProtectedCustomerDataRead(
            OrderActor actor,
            TenantOrder order) {
        requireActor(actor);
        auditRecorder.record(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                PROTECTED_CUSTOMER_DATA_READ,
                "order", order.getId().toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "surface", "orderDetail",
                        "fieldSet", "name,address,phone,email")));
    }

    private void auditLineMatch(OrderActor actor, String action, TenantOrder order, OrderLine line,
            SkuMatchSource previousSource, SkuMatchSource targetSource) {
        requireActor(actor);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "order_line", line.getId().toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "orderId", order.getId().toString(),
                        "lineId", line.getId().toString(),
                        "fromMatchSource", previousSource.name(),
                        "toMatchSource", targetSource.name())));
    }

    private static String fingerprint(NormalizedOrder order) {
        StringBuilder canonical = new StringBuilder()
                .append(order.shopId()).append('\n')
                .append(order.externalOrderRef()).append('\n')
                .append(order.currency()).append('\n')
                .append(Objects.toString(order.buyerFingerprintSource(), "")).append('\n')
                .append(order.placedAt()).append('\n');
        if (order.warehouseId() != null
                || !emptyOperational(order.operational())
                || !OrderProfile.empty().equals(order.profile())) {
            appendLengthPrefixed(canonical, "warehouse",
                    Objects.toString(order.warehouseId(), ""));
            appendLengthPrefixed(canonical, "operational",
                    order.operational().toString());
            appendLengthPrefixed(canonical, "profile",
                    order.profile().toString());
            canonical.append('\n');
        }
        order.lines().forEach(line -> {
            canonical.append(Objects.toString(line.skuId(), "")).append('|')
                    .append(line.externalLineRef()).append('|').append(line.titleFingerprintSource()).append('|')
                    .append(line.quantity()).append('|').append(line.unitPriceMinor()).append('|')
                    .append(line.currency());
            if (line.externalListingRef() != null || line.externalVariantRef() != null) {
                appendLengthPrefixed(canonical, "listing", line.externalListingRef());
                appendLengthPrefixed(canonical, "variant", line.externalVariantRef());
            }
            canonical.append('\n');
        });
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static boolean emptyOperational(
            TenantOrder.OperationalMetadata value) {
        return value != null
                && value.platformStatus() == null
                && value.paymentStatus() == null
                && value.logisticsChannel() == null
                && value.countryCode() == null
                && value.province() == null
                && value.postalCode() == null
                && value.buyerSelectedLogistics() == null
                && value.totalAmountMinor() == null
                && value.shippingAmountMinor() == null
                && value.weightGrams() == null
                && value.paidAt() == null
                && value.shipByAt() == null
                && value.shippedAt() == null
                && value.trackingStatus() == null
                && value.fixedCategory() == null
                && value.customCategory() == null
                && value.warehouseId() == null
                && !value.reshipment()
                && value.reshipmentReason() == null
                && !value.platformHandoverRequired()
                && !value.printed();
    }

    private static String required(String value) {
        String normalized = trimNullable(value);
        if (normalized == null) { throw new IllegalArgumentException("A required value is missing"); }
        return normalized;
    }
    private static String trimNullable(String value) {
        return value == null || value.isBlank() ? null : value.replaceAll("[\\r\\n\\t]+", " ").trim();
    }
    private static String truncate(String value, int maxLength) {
        return value == null || value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
    private static void appendLengthPrefixed(StringBuilder target, String field, String value) {
        String safeValue = Objects.toString(value, "");
        target.append('|').append(field).append(':').append(safeValue.length()).append(':').append(safeValue);
    }
    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) { throw new IllegalArgumentException("Tenant ID is required"); }
    }
    private static void requireActor(OrderActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
    }

    public record OrderActor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String requestId,
            String sourceIp) {
        public OrderActor(UUID tenantId, UUID userId, String requestId) {
            this(tenantId, userId, null, requestId, null);
        }
    }
    public record CreateOrderCommand(
            UUID shopId,
            String externalOrderRef,
            String idempotencyKey,
            String currency,
            String buyerReference,
            Instant placedAt,
            UUID warehouseId,
            TenantOrder.OperationalMetadata operational,
            OrderProfile profile,
            List<CreateLineCommand> lines) {
        public CreateOrderCommand(
                UUID shopId, String externalOrderRef, String idempotencyKey,
                String currency, String buyerReference, Instant placedAt,
                List<CreateLineCommand> lines) {
            this(shopId, externalOrderRef, idempotencyKey, currency,
                    buyerReference, placedAt, null,
                    new TenantOrder.OperationalMetadata(
                            null, null, null, null, null, null, null,
                            null, null, null, null, null, null, null,
                            null, null, null, false, null, false, false),
                    OrderProfile.empty(), lines);
        }
    }
    public record CreateLineCommand(UUID skuId, String externalListingRef, String externalVariantRef,
            String externalLineRef, String titleSnapshot, int quantity, long unitPriceMinor, String currency) {
        public CreateLineCommand(UUID skuId, String externalLineRef, String titleSnapshot,
                int quantity, long unitPriceMinor, String currency) {
            this(skuId, null, null, externalLineRef, titleSnapshot, quantity, unitPriceMinor, currency);
        }
    }
    public record OrderAggregate(
            TenantOrder order,
            OrderProfile profile,
            List<OrderActivity> activities,
            List<OrderLine> lines,
            Map<UUID, String> skuBusinessCodes) {
        public OrderAggregate {
            activities = List.copyOf(activities);
            lines = List.copyOf(lines);
            skuBusinessCodes = Map.copyOf(skuBusinessCodes);
        }

        public OrderAggregate(
                TenantOrder order, OrderProfile profile,
                List<OrderActivity> activities, List<OrderLine> lines) {
            this(order, profile, activities, lines, Map.of());
        }

        public OrderAggregate(TenantOrder order, List<OrderLine> lines) {
            this(order, OrderProfile.empty(), List.of(), lines, Map.of());
        }

        public OrderAggregate(
                TenantOrder order, List<OrderLine> lines,
                Map<UUID, String> skuBusinessCodes) {
            this(order, OrderProfile.empty(), List.of(), lines,
                    skuBusinessCodes);
        }
    }
    private record NormalizedOrder(
            UUID shopId,
            String externalOrderRef,
            String idempotencyKey,
            String currency,
            String buyerReference,
            String buyerFingerprintSource,
            Instant placedAt,
            UUID warehouseId,
            TenantOrder.OperationalMetadata operational,
            OrderProfile profile,
            List<NormalizedLine> lines) {
    }
    private record NormalizedLine(UUID skuId, String externalListingRef, String externalVariantRef,
            String externalLineRef, String titleSnapshot, String titleFingerprintSource,
            int quantity, long unitPriceMinor, String currency) { }
    private record ResolvedLine(NormalizedLine line, UUID skuId, SkuMatchSource source) { }
    private record ListingKey(String externalListingRef, String externalVariantRef) { }
}
