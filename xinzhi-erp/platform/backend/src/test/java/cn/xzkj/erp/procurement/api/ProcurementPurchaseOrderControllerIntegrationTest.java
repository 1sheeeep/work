package cn.xzkj.erp.procurement.api;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderConflictException;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderService;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseReturnService;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Page;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = ProcurementPurchaseOrderControllerIntegrationTest.WebConfiguration.class)
class ProcurementPurchaseOrderControllerIntegrationTest {
    private static final UUID ORDER_ID = UUID.randomUUID();
    private static final UUID PLAN_ID = UUID.randomUUID();
    private static final UUID SUPPLIER_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();
    private static final UUID COMMAND_ID = UUID.randomUUID();
    @Autowired private WebApplicationContext context;
    @Autowired private ProcurementPurchaseOrderService service;
    @Autowired private ProcurementPurchaseReturnService returnService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service, returnService);
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void requiresIndependentReadAndWritePermissions() throws Exception {
        mockMvc.perform(get("/api/v1/procurement/orders"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/procurement/orders")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        when(service.list(any(), any(), any(), any(), anyBoolean(), any(), any(), any(), any(), any()))
                .thenReturn(Page.empty());
        mockMvc.perform(get("/api/v1/procurement/orders")
                        .queryParam("receivableOnly", "true")
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk());
        verify(service).list(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.eq(true),
                any(), any(), any(), any(), any());
        mockMvc.perform(post("/api/v1/procurement/orders")
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(false)))
                .andExpect(status().isForbidden());
        verify(service, never()).create(any(), any(), any(), anyLong(), any(), any());
    }

    @Test
    void createReturnsRelativeLocationAndRejectsUnknownFields() throws Exception {
        when(service.create(any(), any(), any(), anyLong(), any(), any()))
                .thenReturn(order());
        mockMvc.perform(post("/api/v1/procurement/orders")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(false)))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/procurement/orders/" + ORDER_ID))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.purchaseOrderId").value(ORDER_ID.toString()))
                .andExpect(jsonPath("$.status").value("NEW_ORDER"));
        mockMvc.perform(post("/api/v1/procurement/orders")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(true)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void directCreateRequiresWritePermissionAndRejectsUnknownFields() throws Exception {
        when(service.createDirect(
                any(), any(), any(), any(), any(), any(), anyLong(), any()))
                .thenReturn(directOrder());
        mockMvc.perform(post("/api/v1/procurement/orders/direct")
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(directCreateJson(false)))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/procurement/orders/direct")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(directCreateJson(false)))
                .andExpect(status().isCreated())
                .andExpect(header().string(
                        "Location", "/api/v1/procurement/orders/" + ORDER_ID))
                .andExpect(jsonPath("$.planId").doesNotExist())
                .andExpect(jsonPath("$.planNo").doesNotExist())
                .andExpect(jsonPath("$.skuId").value(SKU_ID.toString()));
        mockMvc.perform(post("/api/v1/procurement/orders/direct")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(directCreateJson(true)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void conflictExposesOnlyStableReason() throws Exception {
        when(service.create(any(), any(), any(), anyLong(), any(), any()))
                .thenThrow(new ProcurementPurchaseOrderConflictException("supplier_mapping_unavailable"));
        mockMvc.perform(post("/api/v1/procurement/orders")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(false)))
                .andExpect(status().isConflict())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(jsonPath("$.details.reason").value("supplier_mapping_unavailable"));
    }

    @Test
    void receiptRequiresWritePermissionAndRejectsUnknownFields() throws Exception {
        when(service.receive(any(), any(), any(), anyLong(), anyLong()))
                .thenReturn(order());
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/receipts", ORDER_ID)
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(receiptJson(false)))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/receipts", ORDER_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(receiptJson(false)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.purchaseOrderId").value(ORDER_ID.toString()));
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/receipts", ORDER_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(receiptJson(true)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void reviewRequiresWritePermissionAndRejectsUnknownFields() throws Exception {
        when(service.review(any(), eq(ORDER_ID), eq(0L), eq(true), eq("approved")))
                .thenReturn(order());
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/review", ORDER_ID)
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(false)))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/review", ORDER_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(false)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.purchaseOrderId").value(ORDER_ID.toString()));
        verify(service).review(
                any(), eq(ORDER_ID), eq(0L), eq(true), eq("approved"));
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/review", ORDER_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reviewJson(true)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/procurement/orders/{id}/review", ORDER_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-3")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedVersion\":0,\"reviewNote\":\"approved\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void receiptHistoryRequiresReadPermission() throws Exception {
        mockMvc.perform(get("/api/v1/procurement/orders/receipts"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/procurement/orders/receipts")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        when(service.listReceipts(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Page.empty());
        mockMvc.perform(get("/api/v1/procurement/orders/receipts")
                        .queryParam("supplierKeyword", "supplier")
                        .queryParam("purchaseKeyword", "PO-1")
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")));
        verify(service).listReceipts(
                any(), any(), org.mockito.ArgumentMatchers.eq("supplier"),
                org.mockito.ArgumentMatchers.eq("PO-1"), any(), any(), any(), any());
        mockMvc.perform(get("/api/v1/procurement/orders/{id}/receipts", ORDER_ID)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk());
    }

    @Test
    void followUpExportRequiresReadPermissionAndPreservesFilters()
            throws Exception {
        String path = "/api/v1/procurement/orders/follow-up/exports";
        String body = """
                {
                  "searchField": "SUPPLIER_NAME",
                  "keyword": "Supplier",
                  "createdFrom": "2026-08-01T00:00:00Z",
                  "createdTo": "2026-08-02T23:59:59.999Z"
                }
                """;
        String content = "\uFEFF采购单号,计划编号,SKU编号,SKU名称,规格,仓库编码,"
                + "仓库名称,库位编码,库位名称,供应商编码,供应商名称,供应商SKU,"
                + "采购数量,已到货,待到货,状态,下单员,下单时间,最近到货\r\n";
        when(service.exportFollowUpCsv(any(), any(), any(), any(), any()))
                .thenReturn(new ProcurementPurchaseOrderService.ProcurementFollowUpExport(
                        "procurement-follow-up.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("procurement-follow-up.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportFollowUpCsv(
                any(), eq(ProcurementPurchaseOrderSearchField.SUPPLIER_NAME),
                eq("Supplier"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-02T23:59:59.999Z")));
    }

    @Test
    void receiptLedgerExportRequiresReadPermissionAndPreservesFilters()
            throws Exception {
        String path = "/api/v1/procurement/orders/receipts/exports";
        String body = """
                {
                  "supplierKeyword": "Supplier",
                  "purchaseKeyword": "PO-1",
                  "receivedFrom": "2026-08-01T00:00:00Z",
                  "receivedTo": "2026-08-02T23:59:59.999Z",
                  "sort": "SKU_CODE"
                }
                """;
        String content = "\uFEFF入库时间,采购单号,计划编号,供应商编码,供应商名称,"
                + "SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,"
                + "本次入库,入库后库存,库存事件序号,库存事件ID,操作人\r\n";
        when(service.exportReceiptLedgerCsv(
                any(), any(), any(), any(), any(), any()))
                .thenReturn(new ProcurementPurchaseOrderService.ProcurementReceiptLedgerExport(
                        "procurement-receipt-ledger.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("procurement-receipt-ledger.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportReceiptLedgerCsv(
                any(), eq("Supplier"), eq("PO-1"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-02T23:59:59.999Z")),
                eq(cn.xzkj.erp.procurement.domain.ProcurementReceiptSort.SKU_CODE));
    }

    @Test
    void purchaseOrderExportRequiresReadPermissionAndPreservesFilters()
            throws Exception {
        String path = "/api/v1/procurement/orders/exports";
        String body = """
                {
                  "status": "PARTIALLY_RECEIVED",
                  "receivableOnly": true,
                  "searchField": "SUPPLIER_NAME",
                  "keyword": "Supplier",
                  "createdFrom": "2026-08-01T00:00:00Z",
                  "createdTo": "2026-08-02T23:59:59.999Z"
                }
                """;
        String content = "\uFEFF采购单号,状态,计划编号,供应商编码,供应商名称,供应商SKU,"
                + "SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,采购数量,"
                + "已收数量,待收数量,订单备注,下单员,最近到货,创建时间,更新时间\r\n";
        when(service.exportCsv(
                any(), any(), any(Boolean.class), any(), any(), any(), any()))
                .thenReturn(new ProcurementPurchaseOrderService.ProcurementPurchaseOrderExport(
                        "procurement-orders.csv", "text/csv;charset=utf-8",
                        0, content));

        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("procurement-orders.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq(ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED),
                eq(true),
                eq(ProcurementPurchaseOrderSearchField.SUPPLIER_NAME),
                eq("Supplier"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-02T23:59:59.999Z")));
    }

    private static String createJson(boolean unknown) {
        return """
                {"commandId":"%s","planId":"%s","expectedPlanVersion":0,
                 "supplierId":"%s","orderNote":"restock"%s}
                """.formatted(COMMAND_ID, PLAN_ID, SUPPLIER_ID,
                        unknown ? ",\"paymentStatus\":\"PAID\"" : "");
    }

    private static String directCreateJson(boolean unknown) {
        return """
                {"commandId":"%s","supplierId":"%s","skuId":"%s",
                 "warehouseId":"%s","locationId":"%s","quantity":12,
                 "orderNote":"restock"%s}
                """.formatted(
                        COMMAND_ID, SUPPLIER_ID, SKU_ID, WAREHOUSE_ID,
                        LOCATION_ID, unknown ? ",\"paymentStatus\":\"PAID\"" : "");
    }

    private static String receiptJson(boolean unknown) {
        return """
                {"commandId":"%s","expectedVersion":0,"quantity":5%s}
                """.formatted(COMMAND_ID, unknown ? ",\"qualityStatus\":\"PASS\"" : "");
    }

    private static String reviewJson(boolean unknown) {
        return """
                {"expectedVersion":0,"approved":true,"reviewNote":"approved"%s}
                """.formatted(unknown ? ",\"paymentStatus\":\"PAID\"" : "");
    }

    private static ProcurementPurchaseOrderView order() {
        UUID skuId = UUID.randomUUID(); UUID warehouseId = UUID.randomUUID(); UUID locationId = UUID.randomUUID();
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.NEW_ORDER, PLAN_ID,
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "Supplier", null, skuId, "SKU-1", "Product", null,
                warehouseId, "WH-1", "Warehouse", locationId, "LOC-1", "Location",
                12, 0, "restock", "Operator", null, null, null, null, 0, null,
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"));
    }

    private static ProcurementPurchaseOrderView directOrder() {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.NEW_ORDER, null, null,
                SUPPLIER_ID, "SUP-1", "Supplier", null, SKU_ID, "SKU-1",
                "Product", null, WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "LOC-1", "Location", 12, 0, "restock",
                "Operator", null, null, null, null, 0, null,
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"));
    }

    private static TestingAuthenticationToken auth(String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                        UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(),
                        "tester", "Tester"), "not-used", authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @EnableMethodSecurity
    static class WebConfiguration {
        @Bean ProcurementPurchaseOrderService service() { return mock(ProcurementPurchaseOrderService.class); }
        @Bean ProcurementPurchaseReturnService returnService() { return mock(ProcurementPurchaseReturnService.class); }
        @Bean ProcurementPurchaseOrderController controller(ProcurementPurchaseOrderService service, ProcurementPurchaseReturnService returnService) { return new ProcurementPurchaseOrderController(service, returnService); }
        @Bean ApiExceptionHandler apiExceptionHandler() { return new ApiExceptionHandler(); }
        @Bean SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
            return http.csrf(csrf -> csrf.disable()).httpBasic(Customizer.withDefaults())
                    .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
                    .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint((request, response, error) -> response.sendError(401))).build();
        }
    }
}
