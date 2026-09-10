package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.api.OrderOperationsDtos.BulkStatusItem;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferFilterRequest;
import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.PageResult;
import cn.xzkj.erp.order.repository.OrderTransferRepository;
import cn.xzkj.erp.order.repository.OrderTransferRepository.CommandJob;
import cn.xzkj.erp.order.repository.OrderTransferRepository.TransferJob;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.service.ConflictException;

class OrderOperationsServiceTest {

    private static final UUID TENANT =
            UUID.fromString("a4600000-0000-4000-8000-000000000001");
    private static final UUID USER =
            UUID.fromString("a4600000-0000-4000-8000-000000000002");
    private static final UUID ORDER_A =
            UUID.fromString("a4600000-0000-4000-8000-000000000010");
    private static final UUID ORDER_B =
            UUID.fromString("a4600000-0000-4000-8000-000000000011");
    private static final UUID JOB =
            UUID.fromString("a4600000-0000-4000-8000-000000000020");

    private OrderCenterService orders;
    private OrderListQueryRepository list;
    private OrderTransferRepository transfers;
    private SecurityAuditRecorder audits;
    private OrderOperationsService service;
    private OrderActor actor;

    @BeforeEach
    void setUp() {
        orders = mock(OrderCenterService.class);
        list = mock(OrderListQueryRepository.class);
        transfers = mock(OrderTransferRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new OrderOperationsService(
                orders, list, transfers, audits,
                Clock.fixed(Instant.parse("2026-07-30T12:00:00Z"), ZoneOffset.UTC));
        actor = new OrderActor(TENANT, USER, null, "request-1", "127.0.0.1");
    }

    @Test
    void transferHistoryIsTenantScopedStableAndPaged() {
        Instant created = Instant.parse("2026-07-30T11:00:00Z");
        when(transfers.list(TENANT, 1, 20)).thenReturn(List.of(
                new TransferJob(
                        JOB, "EXPORT", "SUCCEEDED", 2, 2, 0,
                        null, "inline:orders.csv", 0, created, created)));
        when(transfers.count(TENANT)).thenReturn(21L);

        var result = service.listTransfers(TENANT, 1, 20);

        assertThat(result.items()).hasSize(1);
        assertThat(result.totalElements()).isEqualTo(21);
        assertThat(result.totalPages()).isEqualTo(2);
        verify(transfers).list(TENANT, 1, 20);
        verify(transfers).count(TENANT);
    }

    @Test
    void bulkStatusLocksCommandSortsOrdersAndReplaysWithoutMutating() {
        UUID commandId = UUID.randomUUID();
        when(transfers.recordCompletedCommand(
                eq(TENANT), eq(USER), eq(null), eq("BULK_STATUS"), eq(2),
                eq(commandId), any()))
                .thenReturn(JOB);

        var result = service.bulkStatus(
                actor, commandId, OrderStatus.CANCELLED, null,
                List.of(
                        new BulkStatusItem(ORDER_B, 2),
                        new BulkStatusItem(ORDER_A, 1)));

        assertThat(result.jobId()).isEqualTo(JOB);
        var ordered = org.mockito.Mockito.inOrder(orders);
        ordered.verify(orders).changeStatus(
                actor, ORDER_A, 1, OrderStatus.CANCELLED, null);
        ordered.verify(orders).changeStatus(
                actor, ORDER_B, 2, OrderStatus.CANCELLED, null);
        verify(transfers).lockCommand(TENANT, commandId);

        ArgumentCaptor<String> fingerprint = ArgumentCaptor.forClass(String.class);
        verify(transfers).recordCompletedCommand(
                eq(TENANT), eq(USER), eq(null), eq("BULK_STATUS"), eq(2),
                eq(commandId), fingerprint.capture());
        when(transfers.findCommand(TENANT, commandId)).thenReturn(
                java.util.Optional.of(new CommandJob(
                        JOB, fingerprint.getValue(), 2, 2, 0, "SUCCEEDED")));

        var replay = service.bulkStatus(
                actor, commandId, OrderStatus.CANCELLED, null,
                List.of(
                        new BulkStatusItem(ORDER_A, 1),
                        new BulkStatusItem(ORDER_B, 2)));

        assertThat(replay.jobId()).isEqualTo(JOB);
        verify(orders).changeStatus(
                actor, ORDER_A, 1, OrderStatus.CANCELLED, null);
        verify(orders).changeStatus(
                actor, ORDER_B, 2, OrderStatus.CANCELLED, null);
    }

    @Test
    void bulkStatusRejectsDuplicateOrdersAndConflictingReplay() {
        UUID commandId = UUID.randomUUID();
        assertThatThrownBy(() -> service.bulkStatus(
                actor, commandId, OrderStatus.HOLD, "REVIEW",
                List.of(
                        new BulkStatusItem(ORDER_A, 1),
                        new BulkStatusItem(ORDER_A, 1))))
                .isInstanceOf(IllegalArgumentException.class);
        verify(orders, never()).changeStatus(any(), any(), anyLong(), any(), any());

        when(transfers.findCommand(TENANT, commandId)).thenReturn(
                java.util.Optional.of(new CommandJob(
                        JOB, "0".repeat(64), 1, 1, 0, "SUCCEEDED")));
        assertThatThrownBy(() -> service.bulkStatus(
                actor, commandId, OrderStatus.HOLD, "REVIEW",
                List.of(new BulkStatusItem(ORDER_A, 1))))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void exportProducesBoundedUtf8CsvAndPreservesLiteralFilter() {
        UUID shopId = UUID.randomUUID();
        when(list.shopExists(TENANT, shopId)).thenReturn(true);
        when(orders.searchOrders(eq(actor), any(), eq(0), eq(10_001)))
                .thenReturn(new PageResult(List.of(item()), 1));
        when(transfers.recordCompleted(
                eq(TENANT), eq(USER), eq(null), eq("EXPORT"), eq(1), eq(1),
                eq(0), any(), any(), eq("text/csv"), any(byte[].class)))
                .thenReturn(JOB);

        var result = service.exportCsv(actor, new TransferFilterRequest(
                shopId, null, OrderStatus.HOLD, "PAID", null, "CN",
                null, "CNY", null, null, null, null, null, null,
                null, null, null, null, "%_\\", "SKU_%"));

        String csv = new String(
                Base64.getDecoder().decode(result.contentBase64()),
                StandardCharsets.UTF_8);
        assertThat(csv).startsWith("\ufeff订单号");
        assertThat(csv)
                .contains("店铺名称")
                .contains("实付金额最小单位")
                .contains("平台费用最小单位")
                .contains("利润最小单位")
                .contains("\"ORDER-\"\"1\"")
                .contains("\"Example Shop\"")
                .contains("\"b***@example.com\"")
                .contains("\"1100\"")
                .contains("\"50\"")
                .contains("\"200\"");
        ArgumentCaptor<OrderListQueryRepository.Query> query =
                ArgumentCaptor.forClass(OrderListQueryRepository.Query.class);
        verify(orders).searchOrders(
                eq(actor), query.capture(), eq(0), eq(10_001));
        assertThat(query.getValue().keyword()).isEqualTo("%_\\");
        assertThat(query.getValue().skuKeyword()).isEqualTo("SKU_%");
    }

    @Test
    void exportNeutralizesSpreadsheetFormulaPrefixesInEveryExternalTextCell() {
        when(orders.searchOrders(eq(actor), any(), eq(0), eq(10_001)))
                .thenReturn(new PageResult(List.of(itemWithText(
                        "=2+3", "+8613800000000", "-SKU-1", "@SUM(A1:A2)")), 1));
        when(transfers.recordCompleted(
                eq(TENANT), eq(USER), eq(null), eq("EXPORT"), eq(1), eq(1),
                eq(0), any(), any(), eq("text/csv"), any(byte[].class)))
                .thenReturn(JOB);

        var result = service.exportCsv(
                actor, new TransferFilterRequest(
                        null, null, null, null, null, null, null, null,
                        null, null, null, null, null, null, null, null,
                        null, null, null, null));
        String csv = new String(
                Base64.getDecoder().decode(result.contentBase64()),
                StandardCharsets.UTF_8);

        assertThat(csv)
                .contains("\"'=2+3\"")
                .contains("\"'+8613800000000\"")
                .contains("\"'-SKU-1\"")
                .contains("\"'@SUM(A1:A2)\"");
    }

    @Test
    void importRequiresExactHeaderAndCreatesGroupedOrdersAtomically() {
        UUID shop = UUID.fromString("a4600000-0000-4000-8000-000000000030");
        String csv = """
                externalOrderRef,shopId,placedAt,currency,buyerReference,externalLineRef,title,quantity,unitPriceMinor,skuId,externalListingRef,externalVariantRef
                ORDER-1,%s,2026-07-30T00:00:00Z,CNY,b***@example.com,L1,商品一,1,100,,,
                ORDER-1,%s,2026-07-30T00:00:00Z,CNY,b***@example.com,L2,"商品,二",2,200,,,
                """.formatted(shop, shop);
        when(transfers.recordCompleted(
                eq(TENANT), eq(USER), eq(null), eq("IMPORT"), eq(1), eq(1),
                eq(0), eq("upload:uat-orders.csv"), eq(null), eq(null),
                eq(null)))
                .thenReturn(JOB);

        var result = service.importCsv(
                actor, "import-1", "C:\\fakepath\\uat-orders.csv",
                csv.getBytes(StandardCharsets.UTF_8));

        assertThat(result.succeededCount()).isOne();
        ArgumentCaptor<CreateOrderCommand> command =
                ArgumentCaptor.forClass(CreateOrderCommand.class);
        verify(orders).createOrder(eq(actor), command.capture());
        assertThat(command.getValue().lines()).hasSize(2);
        assertThat(command.getValue().lines().get(1).titleSnapshot())
                .isEqualTo("商品,二");

        assertThatThrownBy(() -> service.importCsv(
                actor, "import-2", "bad,header\n1,2\n"
                        .getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.importCsv(
                actor, "import-3", "orders.exe",
                csv.getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static OrderListItem item() {
        return itemWithText(
                "ORDER-\"1", "b***@example.com", "SKU-1", "商品一");
    }

    private static OrderListItem itemWithText(
            String externalOrderRef, String buyerReference,
            String skuSummary, String titleSummary) {
        Instant time = Instant.parse("2026-07-30T00:00:00Z");
        return new OrderListItem(
                ORDER_A, UUID.randomUUID(), "Example Shop", null,
                externalOrderRef, "CNY",
                buyerReference, OrderStatus.HOLD, "ADDRESS_REVIEW", 2,
                time, time, time, 3, "OPEN", "PAID", "STANDARD", "CN",
                "广东", "510000", "STANDARD", 1200L, 100L,
                new java.math.BigDecimal("250.000"), time, time, null,
                "IN_TRANSIT", "普通", "重点", false, null,
                false, false, null, null, null, null, null,
                1100L, 200L, 80L, 1000L, 50L, 10L, 20L, 30L,
                40L, 60L, 90L,
                null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null,
                null, null, null, null, null,
                skuSummary, titleSummary);
    }
}
