package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.order.domain.OrderDashboardSummary;
import cn.xzkj.erp.order.domain.OrderLine;
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
import cn.xzkj.erp.order.repository.OrderRepository.DashboardSummaryProjection;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.order.service.OrderCenterService.CreateLineCommand;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.settings.deadline.ShippingDeadlineSettingService;

@ExtendWith(MockitoExtension.class)
class OrderCenterServiceTest {
    @Mock private OrderRepository orderRepository;
    @Mock private OrderIdempotencyLock idempotencyLock;
    @Mock private OrderAggregateVersionLock aggregateVersionLock;
    @Mock private OrderLineRepository lineRepository;
    @Mock private OrderSkuLookupRepository skuRepository;
    @Mock private OrderListingLookupRepository listingRepository;
    @Mock private TenantShopRepository shopRepository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private OrderCenterService service;

    @BeforeEach
    void setUp() {
        service = new OrderCenterService(orderRepository, idempotencyLock, aggregateVersionLock,
                lineRepository, skuRepository, listingRepository, shopRepository, auditRecorder);
    }

    @Test
    void exactIdempotentReplayReturnsExistingOrderAndDifferentPayloadConflicts() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        OrderActor actor = new OrderActor(tenantId, UUID.randomUUID(), "request-1");
        AtomicReference<TenantOrder> storedOrder = new AtomicReference<>();
        AtomicReference<List<OrderLine>> storedLines = new AtomicReference<>(List.of());
        when(orderRepository.findByTenantIdAndIdempotencyKey(tenantId, "idem-1"))
                .thenAnswer(invocation -> Optional.ofNullable(storedOrder.get()));
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(tenantId, UUID.randomUUID(), "shop", "Shop")));
        when(orderRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            TenantOrder order = invocation.getArgument(0);
            ReflectionTestUtils.setField(order, "id", UUID.randomUUID());
            storedOrder.set(order);
            return order;
        });
        when(lineRepository.saveAllAndFlush(any())).thenAnswer(invocation -> {
            List<OrderLine> lines = new ArrayList<>();
            invocation.<Iterable<OrderLine>>getArgument(0).forEach(lines::add);
            storedLines.set(lines);
            return lines;
        });
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(eq(tenantId), any()))
                .thenAnswer(invocation -> storedLines.get());

        var first = service.createOrder(actor, commandWithRefs(
                shopId, "first@example.test", "listing-1", "variant-a"));
        var replay = service.createOrder(actor, commandWithRefs(
                shopId, "first@example.test", "listing-1", "variant-a"));
        assertThat(replay.order()).isSameAs(first.order());
        assertThat(first.order().getBuyerReference()).isEqualTo("[REDACTED_EMAIL]");
        verify(orderRepository, times(1)).saveAndFlush(any());
        verify(auditRecorder, times(1)).recordAtomically(any());

        assertThatThrownBy(() -> service.createOrder(actor, commandWithRefs(
                shopId, "first@example.test", "listing-1", "variant-b")))
                .isInstanceOf(ConflictException.class);
        verify(idempotencyLock, times(3)).acquire(tenantId, "idem-1");
    }

    @Test
    void tenantDeadlineIsAppliedWhenNewOrderHasNoPlatformDeadline() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        Instant placedAt = Instant.parse("2026-07-27T00:00:00Z");
        Instant deadline = Instant.parse("2026-08-01T00:00:00Z");
        prepareCreate(tenantId, shopId);
        ShippingDeadlineSettingService settings =
                mock(ShippingDeadlineSettingService.class);
        when(settings.resolveShipByAt(tenantId, placedAt, null))
                .thenReturn(deadline);
        OrderCenterService deadlineAware = new OrderCenterService(
                orderRepository, idempotencyLock, aggregateVersionLock,
                lineRepository, skuRepository, listingRepository,
                shopRepository, auditRecorder, null, null, null, settings);

        var created = deadlineAware.createOrder(
                new OrderActor(tenantId, UUID.randomUUID(), "deadline-test"),
                command(shopId, null, 1, 100));

        assertThat(created.order().getShipByAt()).isEqualTo(deadline);
        verify(settings).resolveShipByAt(tenantId, placedAt, null);
    }

    @Test
    void requestWithoutNewReferencesReplaysPhaseOneFingerprint() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        OrderActor actor = new OrderActor(tenantId, UUID.randomUUID(), "legacy-replay");
        String buyer = "legacy@example.test";
        TenantOrder legacyOrder = new TenantOrder(tenantId, shopId, "external-order", "idem-1",
                phaseOneFingerprint(shopId, buyer), "USD", "[REDACTED_EMAIL]", 1,
                Instant.parse("2026-07-27T00:00:00Z"));
        ReflectionTestUtils.setField(legacyOrder, "id", UUID.randomUUID());
        when(orderRepository.findByTenantIdAndIdempotencyKey(tenantId, "idem-1"))
                .thenReturn(Optional.of(legacyOrder));
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(
                tenantId, legacyOrder.getId())).thenReturn(List.of());

        var replay = service.createOrder(actor, command(shopId, buyer, 1, 100));

        assertThat(replay.order()).isSameAs(legacyOrder);
        verify(orderRepository, never()).saveAndFlush(any());
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void selectedEmptyWarehouseScopeDownScopesListsAndHidesFactsAndCommands() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        OrderActor scopedActor = new OrderActor(
                tenantId, userId, null, "scope-request", "127.0.0.1");
        OrderListQueryRepository listQueries =
                mock(OrderListQueryRepository.class);
        WarehouseScopeEvaluator scopes =
                mock(WarehouseScopeEvaluator.class);
        when(scopes.evaluate(tenantId, userId, null)).thenReturn(
                new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));
        Query query = new Query(
                null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null,
                null, null, null, null);
        when(listQueries.search(
                tenantId, query, 0, 50, false, Set.of()))
                .thenReturn(new PageResult(List.of(), 0));
        OrderCenterService scopedService = new OrderCenterService(
                orderRepository, idempotencyLock, aggregateVersionLock,
                lineRepository, skuRepository, listingRepository,
                shopRepository, auditRecorder, listQueries, scopes, null);

        assertThat(scopedService.searchOrders(
                scopedActor, query, 0, 50).items()).isEmpty();
        verify(listQueries).search(
                tenantId, query, 0, 50, false, Set.of());

        TenantOrder order = existingOrder(tenantId, orderId);
        order.assignWarehouse(warehouseId);
        when(orderRepository.findByIdAndTenantId(orderId, tenantId))
                .thenReturn(Optional.of(order));
        when(orderRepository.findForUpdate(orderId, tenantId))
                .thenReturn(Optional.of(order));
        when(orderRepository.findWarehouseIds(tenantId, orderId))
                .thenReturn(Set.of(warehouseId));
        when(lineRepository
                .findAllByTenantIdAndOrderIdOrderByExternalLineRef(
                        tenantId, orderId))
                .thenReturn(List.of());
        doThrow(new ResourceNotFoundException("Warehouse was not found"))
                .when(scopes).requireAllVisible(
                        any(WarehouseScopeAccess.class),
                        eq(Set.of(warehouseId)));

        assertThatThrownBy(() -> scopedService.getOrder(
                scopedActor, orderId))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> scopedService.changeStatus(
                scopedActor, orderId, 0, OrderStatus.HOLD,
                "MANUAL_REVIEW"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(auditRecorder, never()).record(any());
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void rejectsInvalidQuantityAndAmountInServiceBoundary() {
        UUID shopId = UUID.randomUUID();
        assertThatThrownBy(() -> service.createOrder(actor(), command(shopId, null, 0, 100)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.createOrder(actor(), command(shopId, null, 1, -1)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(orderRepository, never()).saveAndFlush(any());
    }

    @Test
    void orderListUsesNonNullLowercaseLiteralKeyword() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(orderRepository.searchByTenantId(
                tenantId, null, null, true, "literal %_", pageable))
                .thenReturn(Page.empty(pageable));
        when(orderRepository.searchByTenantId(
                tenantId, null, null, false, "", pageable))
                .thenReturn(Page.empty(pageable));

        service.listOrders(tenantId, null, null, "  LiTeRaL %_  ", pageable);
        service.listOrders(tenantId, null, null, " \t ", pageable);

        verify(orderRepository).searchByTenantId(
                tenantId, null, null, true, "literal %_", pageable);
        verify(orderRepository).searchByTenantId(
                tenantId, null, null, false, "", pageable);
    }

    @Test
    void skuMatchQueueNormalizesKeywordAndValidatesTenantShopWithoutAudit() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        SkuMatchQueueItem item = queueItem(shopId);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shop", "Shop")));
        when(orderRepository.searchSkuMatchQueue(
                tenantId, shopId, true, "literal %_ value", pageable))
                .thenReturn(new PageImpl<>(List.of(item), pageable, 1));

        var result = service.listSkuMatchQueue(
                tenantId, shopId, "  literal %_ value  ", pageable);

        assertThat(result.getContent()).containsExactly(item);
        verify(orderRepository).searchSkuMatchQueue(
                tenantId, shopId, true, "literal %_ value", pageable);
        verifyNoInteractions(auditRecorder);

        when(orderRepository.searchSkuMatchQueue(tenantId, null, false, "", pageable))
                .thenReturn(new PageImpl<>(List.of(), pageable, 0));
        service.listSkuMatchQueue(tenantId, null, " \t ", pageable);
        verify(orderRepository).searchSkuMatchQueue(tenantId, null, false, "", pageable);
    }

    @Test
    void skuMatchQueueRejectsForeignShopAsNotFound() {
        UUID tenantId = UUID.randomUUID(); UUID foreignShopId = UUID.randomUUID();
        when(shopRepository.findByIdAndTenantId(foreignShopId, tenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.listSkuMatchQueue(
                tenantId, foreignShopId, null, PageRequest.of(0, 50)))
                .isInstanceOf(ResourceNotFoundException.class);

        verify(orderRepository, never()).searchSkuMatchQueue(any(), any(), anyBoolean(), any(), any());
        verifyNoInteractions(auditRecorder);
    }

    @Test
    void skuMatchQueueRejectsOverlongKeywordAtServiceBoundary() {
        assertThatThrownBy(() -> service.listSkuMatchQueue(
                UUID.randomUUID(), null, "x".repeat(101), PageRequest.of(0, 50)))
                .isInstanceOf(IllegalArgumentException.class);

        verify(orderRepository, never()).searchSkuMatchQueue(any(), any(), anyBoolean(), any(), any());
        verifyNoInteractions(auditRecorder);
    }

    @Test
    void dashboardSummaryMapsSingleAggregateQueryWithoutAuditOrShopLookup() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        Instant oldest = Instant.parse("2026-07-01T00:00:00Z");
        DashboardSummaryProjection projection = mock(DashboardSummaryProjection.class);
        when(projection.getShopExists()).thenReturn(true);
        when(projection.getTotalOrders()).thenReturn(15L);
        when(projection.getReceivedOrders()).thenReturn(1L);
        when(projection.getReviewPendingOrders()).thenReturn(2L);
        when(projection.getHoldOrders()).thenReturn(3L);
        when(projection.getReadyToFulfillOrders()).thenReturn(4L);
        when(projection.getCancelledOrders()).thenReturn(5L);
        when(projection.getEditableOrders()).thenReturn(6L);
        when(projection.getUnmatchedLines()).thenReturn(7L);
        when(projection.getOldestUnmatchedPlacedAt()).thenReturn(oldest);
        when(orderRepository.summarizeDashboard(tenantId, shopId)).thenReturn(projection);

        OrderDashboardSummary result = service.dashboardSummary(tenantId, shopId);

        assertThat(result).isEqualTo(new OrderDashboardSummary(
                15, 1, 2, 3, 4, 5, 6, 7, oldest));
        verify(orderRepository).summarizeDashboard(tenantId, shopId);
        verifyNoInteractions(shopRepository, auditRecorder);
    }

    @Test
    void dashboardSummaryReturnsNotFoundForUnknownOrForeignShopFromSameQuery() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        DashboardSummaryProjection projection = mock(DashboardSummaryProjection.class);
        when(projection.getShopExists()).thenReturn(false);
        when(orderRepository.summarizeDashboard(tenantId, shopId)).thenReturn(projection);

        assertThatThrownBy(() -> service.dashboardSummary(tenantId, shopId))
                .isInstanceOf(ResourceNotFoundException.class);

        verify(orderRepository).summarizeDashboard(tenantId, shopId);
        verifyNoInteractions(shopRepository, auditRecorder);
    }

    @Test
    void unmatchedLineBlocksReadyAndStaleVersionConflicts() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        order.transition(OrderStatus.REVIEW_PENDING, null);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.hasUnmatchedLine(actor.tenantId(), orderId)).thenReturn(true);

        assertThatThrownBy(() -> service.changeStatus(actor, orderId, 0, OrderStatus.READY_TO_FULFILL, null))
                .isInstanceOf(ConflictException.class);
        ReflectionTestUtils.setField(order, "version", 2L);
        assertThatThrownBy(() -> service.changeStatus(actor, orderId, 1, OrderStatus.HOLD, "review"))
                .isInstanceOf(ConflictException.class);
        verify(orderRepository, never()).saveAndFlush(any());
    }

    @Test
    void matchedOrderBecomesReadyAndExactSameTargetVersionIsIdempotent() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        order.transition(OrderStatus.REVIEW_PENDING, null);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.hasUnmatchedLine(actor.tenantId(), orderId)).thenReturn(false);
        when(orderRepository.saveAndFlush(order)).thenAnswer(invocation -> {
            ReflectionTestUtils.setField(order, "version", 1L);
            return order;
        });
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(actor.tenantId(), orderId))
                .thenReturn(List.of());

        assertThat(service.changeStatus(actor, orderId, 0, OrderStatus.READY_TO_FULFILL, null)
                .order().getStatus()).isEqualTo(OrderStatus.READY_TO_FULFILL);
        assertThat(service.changeStatus(actor, orderId, 1, OrderStatus.READY_TO_FULFILL, null)
                .order().getStatus()).isEqualTo(OrderStatus.READY_TO_FULFILL);
        verify(orderRepository, times(1)).saveAndFlush(order);
        verify(auditRecorder, times(1)).recordAtomically(any());
    }

    @Test
    void blankHoldReasonIsRejectedBeforePersistence() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));

        assertThatThrownBy(() -> service.changeStatus(actor, orderId, 0, OrderStatus.HOLD, " \r\n "))
                .isInstanceOf(IllegalArgumentException.class);
        verify(orderRepository, never()).saveAndFlush(any());
    }

    @Test
    void crossTenantLookupIsNotFound() {
        UUID tenantId = UUID.randomUUID(); UUID orderId = UUID.randomUUID();
        when(orderRepository.findByIdAndTenantId(orderId, tenantId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.getOrder(tenantId, orderId)).isInstanceOf(ResourceNotFoundException.class);
        verify(lineRepository, never()).findAllByTenantIdAndOrderIdOrderByExternalLineRef(any(), any());
    }

    @Test
    void successfulOrderDetailReadRecordsProtectedDataAccessWithoutValues() {
        OrderActor actor = actor();
        UUID orderId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        when(orderRepository.findByIdAndTenantId(
                orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(
                actor.tenantId(), orderId)).thenReturn(List.of());

        var result = service.getOrder(actor, orderId);

        assertThat(result.order().getId()).isEqualTo(orderId);
        ArgumentCaptor<SecurityAuditEvent> event =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).record(event.capture());
        verify(auditRecorder, never()).recordAtomically(any());
        assertThat(event.getValue().tenantId()).isEqualTo(actor.tenantId());
        assertThat(event.getValue().actorUserId()).isEqualTo(actor.userId());
        assertThat(event.getValue().action())
                .isEqualTo("order.protected_customer_data.read");
        assertThat(event.getValue().resourceType()).isEqualTo("order");
        assertThat(event.getValue().resourceId()).isEqualTo(orderId.toString());
        assertThat(event.getValue().details()).containsExactlyInAnyOrderEntriesOf(
                java.util.Map.of(
                        "surface", "orderDetail",
                        "fieldSet", "name,address,phone,email"));
        assertThat(event.getValue().details().toString())
                .doesNotContain("recipient", "buyer@", "+1", "Main St");
    }

    @Test
    void orderDetailResolvesTenantScopedBusinessSkuCodes() {
        OrderActor actor = actor();
        UUID orderId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        OrderLine line = new OrderLine(
                actor.tenantId(), orderId, skuId, "line-1",
                "Widget", 1, 100, "USD");
        when(orderRepository.findByIdAndTenantId(
                orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(
                actor.tenantId(), orderId)).thenReturn(List.of(line));
        when(skuRepository.findAllByTenantIdAndIdIn(
                actor.tenantId(), Set.of(skuId)))
                .thenReturn(List.of(sku(actor.tenantId(), skuId)));

        var result = service.getOrder(actor, orderId);

        assertThat(result.skuBusinessCodes())
                .containsExactly(java.util.Map.entry(skuId, "SKU_TEST"));
    }

    @Test
    void auditContainsOnlyControlledIdentifiersAndStatus() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); OrderActor actor = new OrderActor(tenantId, UUID.randomUUID(), "request-1");
        when(orderRepository.findByTenantIdAndIdempotencyKey(tenantId, "idem-1")).thenReturn(Optional.empty());
        when(shopRepository.findByIdAndTenantId(shopId, tenantId)).thenReturn(Optional.of(mock(TenantShop.class)));
        when(orderRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            TenantOrder order = invocation.getArgument(0); ReflectionTestUtils.setField(order, "id", UUID.randomUUID()); return order;
        });
        when(lineRepository.saveAllAndFlush(any())).thenReturn(List.of());

        var created = service.createOrder(actor, command(shopId, "buyer@example.test", 1, 999));
        assertThat(created.order().getBuyerReference()).isEqualTo("[REDACTED_EMAIL]");
        ArgumentCaptor<SecurityAuditEvent> event = ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(event.capture());
        assertThat(event.getValue().details()).containsOnlyKeys("automaticMatchCount", "unmatchedCount")
                .containsEntry("automaticMatchCount", "0")
                .containsEntry("unmatchedCount", "1");
        assertThat(event.getValue().details().toString())
                .doesNotContain("buyer@example.test", "Widget", "999");
    }

    @Test
    void activeListingAndVariantAutoMatchWithinTenantAndShop() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); UUID skuId = UUID.randomUUID();
        OrderActor actor = new OrderActor(tenantId, UUID.randomUUID(), "auto-match");
        AtomicReference<List<OrderLine>> storedLines = prepareCreate(tenantId, shopId);
        when(listingRepository.findAllByTenantIdAndShopIdAndStatusAndExternalListingRefIn(
                eq(tenantId), eq(shopId), any(), eq(java.util.Set.of("listing-1"))))
                .thenReturn(List.of(listing(tenantId, shopId, skuId, "listing-1", "variant-1")));

        service.createOrder(actor, commandWithRefs(shopId, null, "listing-1", "variant-1"));

        assertThat(storedLines.get()).singleElement().satisfies(line -> {
            assertThat(line.getSkuId()).isEqualTo(skuId);
            assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.LISTING_MAPPING);
            assertThat(line.getExternalListingRef()).isEqualTo("listing-1");
            assertThat(line.getExternalVariantRef()).isEqualTo("variant-1");
        });
    }

    @Test
    void absentArchivedAndForeignMappingsRemainUnmatched() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); UUID skuId = UUID.randomUUID();
        AtomicReference<List<OrderLine>> storedLines = prepareCreate(tenantId, shopId);
        ProductListing archived = listing(tenantId, shopId, skuId, "listing-1", null);
        archived.archive();
        ProductListing otherTenant = listing(UUID.randomUUID(), shopId, skuId, "listing-1", null);
        ProductListing otherShop = listing(tenantId, UUID.randomUUID(), skuId, "listing-1", null);
        when(listingRepository.findAllByTenantIdAndShopIdAndStatusAndExternalListingRefIn(
                eq(tenantId), eq(shopId), any(), any()))
                .thenReturn(List.of(archived, otherTenant, otherShop));

        service.createOrder(new OrderActor(tenantId, UUID.randomUUID(), null),
                commandWithRefs(shopId, null, "listing-1", null));

        assertThat(storedLines.get()).singleElement().satisfies(line -> {
            assertThat(line.getSkuId()).isNull();
            assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.UNMATCHED);
        });
    }

    @Test
    void explicitlyProvidedSkuWinsAndExternalReferencesAreRetained() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); UUID skuId = UUID.randomUUID();
        AtomicReference<List<OrderLine>> storedLines = prepareCreate(tenantId, shopId);
        when(skuRepository.findAllByTenantIdAndIdIn(eq(tenantId), eq(java.util.Set.of(skuId))))
                .thenReturn(List.of(sku(tenantId, skuId)));
        CreateOrderCommand command = new CreateOrderCommand(shopId, "external-order", "idem-1", "USD", null,
                Instant.parse("2026-07-27T00:00:00Z"),
                List.of(new CreateLineCommand(skuId, "listing-1", "variant-1",
                        "line-1", "Widget", 1, 100, "USD")));

        service.createOrder(new OrderActor(tenantId, UUID.randomUUID(), null), command);

        assertThat(storedLines.get()).singleElement().satisfies(line -> {
            assertThat(line.getSkuId()).isEqualTo(skuId);
            assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.PROVIDED);
            assertThat(line.getExternalListingRef()).isEqualTo("listing-1");
        });
        verify(listingRepository, never()).findAllByTenantIdAndShopIdAndStatusAndExternalListingRefIn(
                any(), any(), any(), any());
    }

    @Test
    void manualMatchReplaceAndClearUseOrderVersionAndSafeAudit() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        UUID firstSku = UUID.randomUUID(); UUID secondSku = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        OrderLine line = existingLine(actor.tenantId(), orderId, lineId, null, SkuMatchSource.UNMATCHED);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.findByIdAndTenantIdAndOrderId(lineId, actor.tenantId(), orderId))
                .thenReturn(Optional.of(line));
        when(skuRepository.findByIdAndTenantId(any(), eq(actor.tenantId())))
                .thenAnswer(invocation -> Optional.of(sku(actor.tenantId(), invocation.getArgument(0))));
        when(lineRepository.saveAndFlush(line)).thenReturn(line);
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(actor.tenantId(), orderId))
                .thenReturn(List.of(line));
        org.mockito.Mockito.doAnswer(invocation -> {
            ReflectionTestUtils.setField(order, "version", order.getVersion() + 1);
            return null;
        }).when(aggregateVersionLock).forceIncrement(order);

        service.changeLineSkuMatch(actor, orderId, lineId, 0, firstSku);
        assertThat(line.getSkuId()).isEqualTo(firstSku);
        assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.MANUAL);
        service.changeLineSkuMatch(actor, orderId, lineId, 1, secondSku);
        assertThat(line.getSkuId()).isEqualTo(secondSku);
        service.changeLineSkuMatch(actor, orderId, lineId, 2, null);
        assertThat(line.getSkuId()).isNull();
        assertThat(line.getSkuMatchSource()).isEqualTo(SkuMatchSource.UNMATCHED);
        verify(aggregateVersionLock, times(3)).forceIncrement(order);

        ArgumentCaptor<SecurityAuditEvent> events = ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder, times(3)).recordAtomically(events.capture());
        assertThat(events.getAllValues()).allSatisfy(event -> {
            assertThat(event.details()).containsOnlyKeys(
                    "orderId", "lineId", "fromMatchSource", "toMatchSource");
            assertThat(event.toString()).doesNotContain(
                    firstSku.toString(), secondSku.toString(), "Widget", "listing");
        });
    }

    @Test
    void sameManualMatchIsIdempotentButStaleAndTerminalChangesConflict() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        ReflectionTestUtils.setField(order, "version", 3L);
        OrderLine line = existingLine(actor.tenantId(), orderId, lineId, skuId, SkuMatchSource.MANUAL);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.findByIdAndTenantIdAndOrderId(lineId, actor.tenantId(), orderId))
                .thenReturn(Optional.of(line));
        when(skuRepository.findByIdAndTenantId(skuId, actor.tenantId()))
                .thenReturn(Optional.of(sku(actor.tenantId(), skuId)));
        when(lineRepository.findAllByTenantIdAndOrderIdOrderByExternalLineRef(actor.tenantId(), orderId))
                .thenReturn(List.of(line));

        assertThat(service.changeLineSkuMatch(actor, orderId, lineId, 3, skuId).order().getVersion())
                .isEqualTo(3);
        verify(lineRepository, never()).saveAndFlush(any());
        verify(aggregateVersionLock, never()).forceIncrement(any());
        verify(auditRecorder, never()).recordAtomically(any());

        assertThatThrownBy(() -> service.changeLineSkuMatch(actor, orderId, lineId, 2, skuId))
                .isInstanceOf(ConflictException.class);
        order.transition(OrderStatus.CANCELLED, null);
        assertThatThrownBy(() -> service.changeLineSkuMatch(actor, orderId, lineId, 3, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void crossTenantLineAndSkuAreNotFound() {
        OrderActor actor = actor(); UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        TenantOrder order = existingOrder(actor.tenantId(), orderId);
        when(orderRepository.findForUpdate(orderId, actor.tenantId())).thenReturn(Optional.of(order));
        when(lineRepository.findByIdAndTenantIdAndOrderId(lineId, actor.tenantId(), orderId))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(existingLine(
                        actor.tenantId(), orderId, lineId, null, SkuMatchSource.UNMATCHED)));

        assertThatThrownBy(() -> service.changeLineSkuMatch(actor, orderId, lineId, 0, UUID.randomUUID()))
                .isInstanceOf(ResourceNotFoundException.class);
        UUID foreignSku = UUID.randomUUID();
        when(skuRepository.findByIdAndTenantId(foreignSku, actor.tenantId())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.changeLineSkuMatch(actor, orderId, lineId, 0, foreignSku))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private static OrderActor actor() { return new OrderActor(UUID.randomUUID(), UUID.randomUUID(), null); }
    private static CreateOrderCommand command(UUID shopId, String buyer, int quantity, long price) {
        return new CreateOrderCommand(shopId, "external-order", "idem-1", "USD", buyer,
                Instant.parse("2026-07-27T00:00:00Z"),
                List.of(new CreateLineCommand(null, "line-1", "Widget", quantity, price, "USD")));
    }
    private static CreateOrderCommand commandWithRefs(UUID shopId, String buyer, String listingRef, String variantRef) {
        return new CreateOrderCommand(shopId, "external-order", "idem-1", "USD", buyer,
                Instant.parse("2026-07-27T00:00:00Z"),
                List.of(new CreateLineCommand(null, listingRef, variantRef,
                        "line-1", "Widget", 1, 100, "USD")));
    }
    private static String phaseOneFingerprint(UUID shopId, String buyer) {
        String canonical = shopId + "\nexternal-order\nUSD\n" + buyer
                + "\n2026-07-27T00:00:00Z\n|line-1|Widget|1|100|USD\n";
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }
    private AtomicReference<List<OrderLine>> prepareCreate(UUID tenantId, UUID shopId) {
        AtomicReference<List<OrderLine>> storedLines = new AtomicReference<>(List.of());
        when(orderRepository.findByTenantIdAndIdempotencyKey(tenantId, "idem-1")).thenReturn(Optional.empty());
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(tenantId, UUID.randomUUID(), "shop", "Shop")));
        when(orderRepository.saveAndFlush(any())).thenAnswer(invocation -> {
            TenantOrder order = invocation.getArgument(0);
            ReflectionTestUtils.setField(order, "id", UUID.randomUUID());
            return order;
        });
        when(lineRepository.saveAllAndFlush(any())).thenAnswer(invocation -> {
            List<OrderLine> lines = new ArrayList<>();
            invocation.<Iterable<OrderLine>>getArgument(0).forEach(lines::add);
            lines.forEach(line -> ReflectionTestUtils.setField(line, "id", UUID.randomUUID()));
            storedLines.set(lines);
            return lines;
        });
        return storedLines;
    }
    private static ProductListing listing(UUID tenantId, UUID shopId, UUID skuId,
            String listingRef, String variantRef) {
        return new ProductListing(tenantId, shopId, UUID.randomUUID(), skuId,
                listingRef, variantRef, null, null);
    }
    private static ProductSku sku(UUID tenantId, UUID skuId) {
        ProductSku sku = new ProductSku(tenantId, UUID.randomUUID(), "SKU_TEST", "SKU", null);
        ReflectionTestUtils.setField(sku, "id", skuId);
        return sku;
    }
    private static SkuMatchQueueItem queueItem(UUID shopId) {
        return new SkuMatchQueueItem(
                UUID.randomUUID(), 3, OrderStatus.HOLD, shopId, "order-ref",
                Instant.parse("2026-07-27T00:00:00Z"), UUID.randomUUID(), "line-ref",
                "Title", "listing-ref", "variant-ref", null, SkuMatchSource.UNMATCHED);
    }
    private static OrderLine existingLine(UUID tenantId, UUID orderId, UUID lineId,
            UUID skuId, SkuMatchSource source) {
        OrderLine line = new OrderLine(tenantId, orderId, skuId, null, null, source,
                "line-1", "Widget", 1, 100, "USD");
        ReflectionTestUtils.setField(line, "id", lineId);
        return line;
    }
    private static TenantOrder existingOrder(UUID tenantId, UUID orderId) {
        TenantOrder order = new TenantOrder(tenantId, UUID.randomUUID(), "external", "idem", "a".repeat(64),
                "USD", null, 1, Instant.parse("2026-07-27T00:00:00Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        return order;
    }
}
