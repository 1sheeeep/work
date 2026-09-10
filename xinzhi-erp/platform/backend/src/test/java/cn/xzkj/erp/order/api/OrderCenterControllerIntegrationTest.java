package cn.xzkj.erp.order.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.customer.service.CustomerServiceWorkloadAuthenticationFilter;
import cn.xzkj.erp.fulfillment.api.FulfillmentApiExceptionHandler;
import cn.xzkj.erp.fulfillment.api.FulfillmentController;
import cn.xzkj.erp.fulfillment.service.FulfillmentService;
import cn.xzkj.erp.fulfillment.service.ShopifyFulfillmentPublicationService;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentService;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.order.domain.OrderDashboardSummary;
import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.SkuMatchQueueItem;
import cn.xzkj.erp.order.domain.SkuMatchSource;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.PageResult;
import cn.xzkj.erp.order.repository.OrderTransferRepository.TransferJob;
import cn.xzkj.erp.order.service.OrderCenterService;
import cn.xzkj.erp.order.service.OrderOperationsService;
import cn.xzkj.erp.order.service.OrderOperationsService.TransferPage;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderShopifyCatalogImportService;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService;
import cn.xzkj.erp.order.service.OrderShopifyShippingAddressService;
import cn.xzkj.erp.order.service.OrderShopifyShippingAddressService.ShippingAddressUpdateResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {SecurityConfig.class, OrderCenterControllerIntegrationTest.WebConfiguration.class})
class OrderCenterControllerIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private OrderCenterService service;
    @Autowired private OrderListQueryRepository listQueryRepository;
    @Autowired private OrderOperationsService operationsService;
    @Autowired private FulfillmentService fulfillmentService;
    @Autowired private OrderShopifyCatalogPreviewService shopifyCatalogPreviewService;
    @Autowired private OrderShopifyCatalogImportService shopifyCatalogImportService;
    @Autowired private OrderShopifyShippingAddressService shopifyShippingAddressService;
    @Autowired private LogisticsShipmentService logisticsShipmentService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service, listQueryRepository);
        reset(operationsService, fulfillmentService, shopifyCatalogPreviewService,
                shopifyCatalogImportService, shopifyShippingAddressService,
                logisticsShipmentService);
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void securityChainReturns401AndMethodSecurityReturns403() throws Exception {
        mockMvc.perform(get("/api/v1/order-center/orders"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));
        mockMvc.perform(get("/api/v1/order-center/orders")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "products.read"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        verify(listQueryRepository, never()).search(any(), any(), anyInt(), anyInt());
    }

    @Test
    void missingCustomerServiceWorkloadFilterFailsClosed() throws Exception {
        mockMvc.perform(post(CustomerServiceWorkloadAuthenticationFilter.REDEEM_PATH))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code")
                        .value("customer_service_entry_unavailable"));
    }

    @Test
    void methodSecurityRequiresOrderReadForShopifyCatalogPreview() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(get("/api/v1/order-center/shopify/catalog-preview")
                        .queryParam("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.listing.read"))))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/v1/order-center/shopify/catalog-preview")
                        .queryParam("shopId", shopId.toString())
                        .queryParam("limit", "25")
                        .queryParam("cursor", "opaque==")
                        .queryParam("query", "created_at:>=2026-07-01")
                        .queryParam("historical", "true")
                        .header("X-Request-Id", "catalog-preview-1")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read"))))
                .andExpect(status().isOk());

        ArgumentCaptor<OrderActor> actor =
                ArgumentCaptor.forClass(OrderActor.class);
        verify(shopifyCatalogPreviewService).preview(
                actor.capture(), eq(shopId), eq(25), eq("opaque=="),
                eq("created_at:>=2026-07-01"), eq(true));
        assertThat(actor.getValue().tenantId()).isEqualTo(tenantId);
        assertThat(actor.getValue().userId()).isNotNull();
        assertThat(actor.getValue().systemAdminId()).isNull();
        assertThat(actor.getValue().requestId()).isEqualTo("catalog-preview-1");
    }

    @Test
    void shopifyCatalogPreviewReturnsMachineReadableAuthorizationConflict()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopifyCatalogPreviewService.preview(
                any(OrderActor.class),
                eq(shopId),
                eq(50),
                isNull(),
                isNull(),
                eq(false)))
                .thenThrow(ShopifyAuthorizationConflictException.missingScope(
                        "read_orders"));

        mockMvc.perform(get("/api/v1/order-center/shopify/catalog-preview")
                        .queryParam("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("shopify_authorization_conflict"))
                .andExpect(jsonPath("$.message")
                        .value("Shopify authorization must be connected and include the required scope"))
                .andExpect(jsonPath("$.details.reason")
                        .value("shopify_scope_missing"))
                .andExpect(jsonPath("$.details.scope")
                        .value("read_orders"));
    }

    @Test
    void methodSecurityRequiresOrderWriteForShopifyCatalogImport() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        String payload = """
                {
                  "shopId":"%s",
                  "limit":25,
                  "cursor":"opaque==",
                  "query":"created_at:>=2026-07-01",
                  "historical":true,
                  "externalOrderRefs":["gid://shopify/Order/100"]
                }
                """.formatted(shopId);

        mockMvc.perform(post("/api/v1/order-center/shopify/catalog-import")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/order-center/shopify/catalog-import")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk());

        verify(shopifyCatalogImportService).importSelectedOrders(
                any(OrderActor.class), eq(shopId), eq(25), eq("opaque=="),
                eq("created_at:>=2026-07-01"),
                eq(true),
                eq(List.of("gid://shopify/Order/100")));
    }

    @Test
    void shopifyCatalogImportReturnsMachineReadableAuthorizationConflict()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopifyCatalogImportService.importSelectedOrders(
                any(OrderActor.class),
                eq(shopId),
                eq(50),
                isNull(),
                isNull(),
                eq(false),
                eq(List.of("gid://shopify/Order/100"))))
                .thenThrow(ShopifyAuthorizationConflictException.missingScope(
                        "read_orders"));

        mockMvc.perform(post("/api/v1/order-center/shopify/catalog-import")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "shopId":"%s",
                                  "externalOrderRefs":["gid://shopify/Order/100"]
                                }
                                """.formatted(shopId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("shopify_authorization_conflict"))
                .andExpect(jsonPath("$.details.reason")
                        .value("shopify_scope_missing"))
                .andExpect(jsonPath("$.details.scope")
                        .value("read_orders"));
    }

    @Test
    void shopifyShippingAddressRequiresOrderWriteAndDispatchesValidatedCommand()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        when(shopifyShippingAddressService.update(
                any(OrderActor.class), eq(orderId), any()))
                .thenReturn(new ShippingAddressUpdateResult(
                        aggregateWithLine(tenantId, orderId, lineId),
                        Instant.parse("2026-07-31T10:00:00Z"), false));
        String payload = """
                {
                  "version":0,
                  "profileVersion":0,
                  "idempotencyKey":"address-command-1",
                  "address":{
                    "firstName":"Ada",
                    "lastName":"Lovelace",
                    "address1":"1 Main Street",
                    "city":"Toronto",
                    "provinceCode":"ON",
                    "countryCode":"CA",
                    "zip":"A1A1A1"
                  }
                }
                """;

        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/shopify/shipping-address", orderId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isForbidden());

        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/shopify/shipping-address", orderId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replayed").value(false))
                .andExpect(jsonPath("$.synchronizedAt")
                        .value("2026-07-31T10:00:00Z"));

        verify(shopifyShippingAddressService).update(
                any(OrderActor.class), eq(orderId), any());
    }

    @Test
    void shopifyShippingAddressRejectsInvalidCountryBeforeServiceCall()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/shopify/shipping-address", orderId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "version":0,
                                  "profileVersion":0,
                                  "idempotencyKey":"address-command-1",
                                  "address":{
                                    "address1":"1 Main Street",
                                    "city":"Toronto",
                                    "countryCode":"ca"
                                  }
                                }
                                """))
                .andExpect(status().isBadRequest());

        verify(shopifyShippingAddressService, never()).update(
                any(), any(), any());
    }

    @Test
    void orderTransferAndFulfillmentEndpointsFailClosedByPermission() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/order-center/transfers/exports")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(post("/api/v1/order-center/transfers/exports")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.transfer.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(get("/api/v1/order-center/transfers")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(multipart("/api/v1/order-center/transfers/imports")
                        .file("file", "header".getBytes())
                        .param("idempotencyKey", "import-1")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.transfer.read"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(post("/api/v1/fulfillment-center/plans")
                        .with(authentication(tenantAuthentication(tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"orderId":"%s","idempotencyKey":"plan-1"}
                                """.formatted(orderId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(post(
                        "/api/v1/fulfillment-center/plans/{planId}/packages/{packageId}/handover-corrections",
                        UUID.randomUUID(), UUID.randomUUID())
                        .with(authentication(tenantAuthentication(
                                tenantId, "fulfillments.ship.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":1,"packageVersion":1,
                                 "commandId":"46000000-0000-4000-8000-000000000001",
                                 "occurredAt":"2026-07-30T00:00:00Z",
                                 "reasonCode":"WAREHOUSE_CORRECTION"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        UUID planId = UUID.randomUUID();
        UUID packageId = UUID.randomUUID();
        mockMvc.perform(post(
                        "/api/v1/fulfillment-center/plans/{planId}/packages/{packageId}/logistics-booking",
                        planId, packageId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "fulfillments.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"packageVersion":1,
                                 "authorizationId":"46000000-0000-4000-8000-000000000002",
                                 "channelId":"46000000-0000-4000-8000-000000000003",
                                 "idempotencyKey":"logistics-booking-1"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(post(
                        "/api/v1/fulfillment-center/plans/{planId}/packages/{packageId}/logistics-sync",
                        planId, packageId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "fulfillments.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));
        mockMvc.perform(post(
                        "/api/v1/fulfillment-center/plans/{planId}/packages/{packageId}/logistics-handover",
                        planId, packageId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "fulfillments.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":1,"packageVersion":1,
                                 "commandId":"46000000-0000-4000-8000-000000000004",
                                 "occurredAt":"2026-08-14T00:00:00Z"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        verify(operationsService, never()).exportCsv(any(), any());
        verify(operationsService, never()).listTransfers(any(), anyInt(), anyInt());
        verify(operationsService, never()).importCsv(any(), any(), any());
        verify(fulfillmentService, never()).create(any(), any(), any());
        verify(fulfillmentService, never()).correctHandover(
                any(), any(), any(), anyLong(), anyLong(), any(), any(), any());
        verify(logisticsShipmentService, never()).book(
                any(), any(), any(), anyLong(), any(), any(), any());
        verify(logisticsShipmentService, never()).sync(any(), any(), any());
        verify(logisticsShipmentService, never()).handover(
                any(), any(), any(), anyLong(), anyLong(), any(), any());
    }

    @Test
    void transferHistoryUsesPrincipalTenantAndReturnsOnlyAllowlistedMetadata() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        Instant created = Instant.parse("2026-07-30T00:00:00Z");
        when(operationsService.listTransfers(tenantId, 0, 20)).thenReturn(
                new TransferPage(List.of(
                        new TransferJob(
                                jobId, "EXPORT", "SUCCEEDED", 2, 2, 0,
                                null, "inline:orders.csv", 0, created, created)),
                        0, 20, 1, 1));

        mockMvc.perform(get("/api/v1/order-center/transfers")
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.transfer.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(jobId.toString()))
                .andExpect(jsonPath("$.items[0].jobType").value("EXPORT"))
                .andExpect(jsonPath("$.items[0].status").value("SUCCEEDED"))
                .andExpect(content().string(not(containsString("objectReference"))))
                .andExpect(content().string(not(containsString("requestFingerprint"))))
                .andExpect(content().string(not(containsString("filterSpec"))));
        verify(operationsService).listTransfers(tenantId, 0, 20);
    }

    @Test
    void transferUploadRejectsInvalidMediaBeforeServiceAndIgnoresTenantHeader() throws Exception {
        UUID tenantId = UUID.randomUUID();
        mockMvc.perform(multipart("/api/v1/order-center/transfers/imports")
                        .file("file", "not,csv".getBytes())
                        .param("idempotencyKey", "import-1")
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.transfer.write"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));
        verify(operationsService, never()).importCsv(any(), any(), any());
    }

    @Test
    void forgedTenantHeaderIsIgnoredAndCrossTenantOrderIs404() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID forgedTenant = UUID.randomUUID(); UUID orderId = UUID.randomUUID();
        when(service.getOrder(any(OrderActor.class), eq(orderId)))
                .thenThrow(new ResourceNotFoundException("buyer-secret"));
        mockMvc.perform(get("/api/v1/order-center/orders/{orderId}", orderId)
                        .header("X-Tenant-Id", forgedTenant)
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("buyer-secret"))));
        verify(service).getOrder(any(OrderActor.class), eq(orderId));
    }

    @Test
    void orderDetailReturnsBusinessSkuCodeWithoutReplacingInternalIdentity() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(service.getOrder(any(OrderActor.class), eq(orderId)))
                .thenReturn(aggregateWithMatchedLine(
                        tenantId, orderId, lineId, skuId));

        mockMvc.perform(get("/api/v1/order-center/orders/{orderId}", orderId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lines[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.lines[0].skuCode")
                        .value("SKU-HOSTED-1"));
    }

    @Test
    void validatesQuantityAndMinorUnitAmountWithoutEchoingInput() throws Exception {
        mockMvc.perform(post("/api/v1/order-center/orders")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validRequest("0", "-99", "Bearer private-token")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(content().string(not(containsString("private-token"))))
                .andExpect(content().string(not(containsString("-99"))));
        verify(service, never()).createOrder(any(), any());
    }

    @Test
    void malformedJsonUsesSafeInvalidRequestProtocol() throws Exception {
        mockMvc.perform(post("/api/v1/order-center/orders")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"buyerReference\":\"private-value\""))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("Request body is invalid"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-value"))));
        verify(service, never()).createOrder(any(), any());
    }

    @Test
    void missingStatusVersionIsValidationFailure() throws Exception {
        UUID orderId = UUID.randomUUID();
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/status", orderId)
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetStatus\":\"REVIEW_PENDING\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details.version").value("invalid"));
        verify(service, never()).changeStatus(any(), any(), anyLong(), any(), any());
    }

    @Test
    void creationReturns201AndStableLocation() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID orderId = UUID.randomUUID();
        when(service.createOrder(any(), any())).thenReturn(aggregate(tenantId, orderId));
        mockMvc.perform(post("/api/v1/order-center/orders")
                        .header("X-Request-Id", "order-create-1")
                        .with(authentication(tenantAuthentication(tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validRequest("1", "100", null)))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/api/v1/order-center/orders/" + orderId))
                .andExpect(jsonPath("$.id").value(orderId.toString()))
                .andExpect(jsonPath("$.lines").isArray());
    }

    @Test
    void listUsesStableBoundedPageEnvelopeAndFilters() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        when(listQueryRepository.shopExists(tenantId, shopId)).thenReturn(true);
        when(service.searchOrders(any(OrderActor.class), any(), eq(1), eq(200)))
                .thenReturn(new PageResult(List.of(summaryItem(shopId)), 1));
        mockMvc.perform(get("/api/v1/order-center/orders")
                        .param("shopId", shopId.toString()).param("status", "HOLD")
                        .param("keyword", "needle").param("page", "1").param("size", "200")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(200))
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items[0].shopName").value("Example Shop"))
                .andExpect(jsonPath("$.items[0].salesRecordNumber").value("TXN-001"))
                .andExpect(jsonPath("$.items[0].shoppingCartReference").value("CART-001"))
                .andExpect(jsonPath("$.items[0].customOrderReference").value("INTERNAL-001"))
                .andExpect(jsonPath("$.items[0].trackingReference").value("TRACK-001"))
                .andExpect(jsonPath("$.items[0].secondaryTrackingReference")
                        .value("TRACK-SECONDARY-001"))
                .andExpect(jsonPath("$.items[0].actualPaidMinor").value(900))
                .andExpect(jsonPath("$.items[0].profitMinor").value(-50))
                .andExpect(jsonPath("$.items[0].actualShippingMinor").value(150))
                .andExpect(jsonPath("$.items[0].itemAmountMinor").value(800))
                .andExpect(jsonPath("$.items[0].platformFeeMinor").value(40))
                .andExpect(jsonPath("$.items[0].insuranceFeeMinor").value(10))
                .andExpect(jsonPath("$.items[0].paymentFeeMinor").value(20))
                .andExpect(jsonPath("$.items[0].otherIncomeMinor").value(30))
                .andExpect(jsonPath("$.items[0].otherExpenseMinor").value(25))
                .andExpect(jsonPath("$.items[0].taxMinor").value(-5))
                .andExpect(jsonPath("$.items[0].estimatedShippingMinor").value(140))
                .andExpect(jsonPath("$.items[0].salespersonDisplayName")
                        .value("Sales Person"))
                .andExpect(jsonPath("$.items[0].managerDisplayName")
                        .value("Order Manager"))
                .andExpect(jsonPath("$.items[0].orderRemark")
                        .value("Reviewed order remark"))
                .andExpect(jsonPath("$.items[0].customerCategory").value("VIP"))
                .andExpect(jsonPath("$.items[0].productKindCount").value(2))
                .andExpect(jsonPath("$.items[0].supplierReference").value("SUP-001"))
                .andExpect(jsonPath("$.items[0].parentProductCategory")
                        .value("Home"))
                .andExpect(jsonPath("$.items[0].childProductCategory")
                        .value("Lighting"))
                .andExpect(jsonPath("$.items[0].productStatus").value("ACTIVE"))
                .andExpect(jsonPath("$.items[0].extendedAttribute")
                        .value("Fragile"))
                .andExpect(jsonPath("$.items[0].warehouseDisplayName")
                        .value("Order Warehouse"))
                .andExpect(jsonPath("$.items[0].locationBusinessCode")
                        .value("PICK-A01"))
                .andExpect(jsonPath("$.items[0].pickerDisplayName")
                        .value("Picker"))
                .andExpect(jsonPath("$.items[0].shipperDisplayName")
                        .value("Shipper"))
                .andExpect(jsonPath("$.items[0].purchaserDisplayName")
                        .value("Purchaser"))
                .andExpect(jsonPath("$.items[0].developerDisplayName")
                        .value("Developer"))
                .andExpect(jsonPath("$.items[0].printedAt").value("2026-07-27T00:00:01Z"))
                .andExpect(jsonPath("$.items[0].platformReturnedAt")
                        .value("2026-07-27T00:00:02Z"))
                .andExpect(jsonPath("$.items[0].exceptionReviewedAt")
                        .value("2026-07-27T00:00:03Z"))
                .andExpect(jsonPath("$.items[0].platformSpecifiedHandoverAt")
                        .value("2026-07-27T00:00:04Z"))
                .andExpect(jsonPath("$.items[0].platformLabelRequestedAt")
                        .value("2026-07-27T00:00:05Z"))
                .andExpect(jsonPath("$.items[0].deliveryDeadlineAt")
                        .value("2026-07-27T00:00:06Z"))
                .andExpect(jsonPath("$.items[0].cancelledAt").value("2026-07-27T00:00:07Z"))
                .andExpect(jsonPath("$.items[0].handedOverAt").value("2026-07-27T00:00:08Z"))
                .andExpect(jsonPath("$.items[0].deliveredAt").value("2026-07-27T00:00:09Z"));
    }

    @Test
    void authenticatedInternalFailureReturnsSafe500InsteadOf401() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(listQueryRepository.search(eq(tenantId), any(), eq(0), eq(50)))
                .thenThrow(new RuntimeException("jdbc:postgresql://private-host/order-secret"));

        mockMvc.perform(get("/api/v1/order-center/orders")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("internal_error"))
                .andExpect(jsonPath("$.message").value("An internal error occurred"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-host"))))
                .andExpect(content().string(not(containsString("order-secret"))));
    }

    @Test
    void listRejectsPageSizeAboveBoundWithoutEchoingInput() throws Exception {
        UUID tenantId = UUID.randomUUID();
        mockMvc.perform(get("/api/v1/order-center/orders")
                        .param("size", "201")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("201"))));
        verify(listQueryRepository, never()).search(any(), any(), anyInt(), anyInt());
    }

    @Test
    void skuMatchQueueUsesReadPermissionPrincipalTenantAndWhitelistResponse() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID forgedTenant = UUID.randomUUID();
        UUID shopId = UUID.randomUUID(); UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        mockMvc.perform(get("/api/v1/order-center/sku-match-queue"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/order-center/sku-match-queue")
                        .with(authentication(tenantAuthentication(tenantId, "orders.write"))))
                .andExpect(status().isForbidden());

        SkuMatchQueueItem item = new SkuMatchQueueItem(
                orderId, 7, OrderStatus.HOLD, shopId, "external-order", Instant.parse("2026-07-20T00:00:00Z"),
                lineId, "external-line", "Safe title", "listing-ref", "variant-ref",
                null, SkuMatchSource.UNMATCHED);
        when(service.listSkuMatchQueue(
                any(OrderActor.class), eq(shopId), eq("%_"), any()))
                .thenReturn(new PageImpl<>(List.of(item), PageRequest.of(0, 50), 1));

        mockMvc.perform(get("/api/v1/order-center/sku-match-queue")
                        .header("X-Tenant-Id", forgedTenant)
                        .param("shopId", shopId.toString()).param("keyword", "%_")
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(50))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].orderId").value(orderId.toString()))
                .andExpect(jsonPath("$.items[0].orderVersion").value(7))
                .andExpect(jsonPath("$.items[0].orderStatus").value("HOLD"))
                .andExpect(jsonPath("$.items[0].shopId").value(shopId.toString()))
                .andExpect(jsonPath("$.items[0].externalOrderRef").value("external-order"))
                .andExpect(jsonPath("$.items[0].lineId").value(lineId.toString()))
                .andExpect(jsonPath("$.items[0].externalLineRef").value("external-line"))
                .andExpect(jsonPath("$.items[0].titleSnapshot").value("Safe title"))
                .andExpect(jsonPath("$.items[0].externalListingRef").value("listing-ref"))
                .andExpect(jsonPath("$.items[0].externalVariantRef").value("variant-ref"))
                .andExpect(jsonPath("$.items[0].skuId").doesNotExist())
                .andExpect(jsonPath("$.items[0].skuMatchSource").value("UNMATCHED"))
                .andExpect(jsonPath("$.items[0].buyerReference").doesNotExist())
                .andExpect(jsonPath("$.items[0].unitPriceMinor").doesNotExist())
                .andExpect(jsonPath("$.items[0].idempotencyKey").doesNotExist())
                .andExpect(jsonPath("$.items[0].audit").doesNotExist());
        verify(service).listSkuMatchQueue(
                any(OrderActor.class), eq(shopId), eq("%_"), any());
    }

    @Test
    void skuMatchQueueRejectsInvalidSizeAndUsesSafeShopNotFound() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        for (String invalidSize : List.of("0", "201")) {
            mockMvc.perform(get("/api/v1/order-center/sku-match-queue")
                            .param("size", invalidSize)
                            .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("validation_failed"))
                    .andExpect(jsonPath("$.message").value("Request validation failed"))
                    .andExpect(content().string(not(containsString(invalidSize))));
        }
        verify(service, never()).listSkuMatchQueue(
                any(OrderActor.class), any(), any(), any());

        mockMvc.perform(get("/api/v1/order-center/sku-match-queue")
                        .param("keyword", "x".repeat(101))
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        verify(service, never()).listSkuMatchQueue(
                any(OrderActor.class), any(), any(), any());

        when(service.listSkuMatchQueue(
                any(OrderActor.class), eq(shopId), eq(null), any()))
                .thenThrow(new ResourceNotFoundException("foreign-shop-private"));
        mockMvc.perform(get("/api/v1/order-center/sku-match-queue")
                        .param("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(content().string(not(containsString("foreign-shop-private"))));
    }

    @Test
    void dashboardSummaryUsesReadPermissionPrincipalTenantAndWhitelistResponse() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID forgedTenant = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        Instant oldest = Instant.parse("2026-07-20T00:00:00Z");
        mockMvc.perform(get("/api/v1/order-center/dashboard-summary"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));
        mockMvc.perform(get("/api/v1/order-center/dashboard-summary")
                        .with(authentication(tenantAuthentication(tenantId, "orders.write"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        when(service.dashboardSummary(any(OrderActor.class), eq(shopId)))
                .thenReturn(new OrderDashboardSummary(
                15, 1, 2, 3, 4, 5, 6, 7, oldest));
        mockMvc.perform(get("/api/v1/order-center/dashboard-summary")
                        .header("X-Tenant-Id", forgedTenant)
                        .param("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.totalOrders").value(15))
                .andExpect(jsonPath("$.receivedOrders").value(1))
                .andExpect(jsonPath("$.reviewPendingOrders").value(2))
                .andExpect(jsonPath("$.holdOrders").value(3))
                .andExpect(jsonPath("$.readyToFulfillOrders").value(4))
                .andExpect(jsonPath("$.cancelledOrders").value(5))
                .andExpect(jsonPath("$.editableOrders").value(6))
                .andExpect(jsonPath("$.unmatchedLines").value(7))
                .andExpect(jsonPath("$.oldestUnmatchedPlacedAt").value("2026-07-20T00:00:00Z"))
                .andExpect(jsonPath("$.buyerReference").doesNotExist())
                .andExpect(jsonPath("$.unitPriceMinor").doesNotExist())
                .andExpect(jsonPath("$.idempotencyKey").doesNotExist())
                .andExpect(jsonPath("$.externalOrderRef").doesNotExist())
                .andExpect(jsonPath("$.orderId").doesNotExist())
                .andExpect(jsonPath("$.lineId").doesNotExist())
                .andExpect(jsonPath("$.audit").doesNotExist())
                .andExpect(jsonPath("$.credentialReference").doesNotExist())
                .andExpect(jsonPath("$.rawPayload").doesNotExist());
        verify(service).dashboardSummary(any(OrderActor.class), eq(shopId));
    }

    @Test
    void dashboardSummaryUsesSafeShopNotFoundProtocol() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID();
        when(service.dashboardSummary(any(OrderActor.class), eq(shopId)))
                .thenThrow(new ResourceNotFoundException("foreign-shop-private"));

        mockMvc.perform(get("/api/v1/order-center/dashboard-summary")
                        .param("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(tenantId, "orders.read"))))
                .andExpect(status().isNotFound())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message").value("Requested resource was not found"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("foreign-shop-private"))));
    }

    @Test
    void optimisticConflictUsesSafeErrorProtocol() throws Exception {
        UUID orderId = UUID.randomUUID();
        when(service.changeStatus(any(), eq(orderId), eq(7L), any(), any()))
                .thenThrow(new ConflictException("buyer-reference-private"));
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/status", orderId)
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":7,\"targetStatus\":\"REVIEW_PENDING\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(content().string(not(containsString("buyer-reference-private"))));
    }

    @Test
    void skuMatchEndpointRequiresWriteAndIgnoresForgedTenantHeader() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID forgedTenant = UUID.randomUUID();
        UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/lines/{lineId}/sku-match", orderId, lineId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0,\"skuId\":null}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/lines/{lineId}/sku-match", orderId, lineId)
                        .with(authentication(tenantAuthentication(tenantId, "orders.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0,\"skuId\":null}"))
                .andExpect(status().isForbidden());

        when(service.changeLineSkuMatch(any(), eq(orderId), eq(lineId), eq(0L), eq(null)))
                .thenReturn(aggregateWithLine(tenantId, orderId, lineId));
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/lines/{lineId}/sku-match", orderId, lineId)
                        .header("X-Tenant-Id", forgedTenant)
                        .header("X-Request-Id", "manual-match-1")
                        .with(authentication(tenantAuthentication(tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0,\"skuId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lines[0].externalListingRef").value("listing-1"))
                .andExpect(jsonPath("$.lines[0].externalVariantRef").value("variant-1"))
                .andExpect(jsonPath("$.lines[0].skuMatchSource").value("UNMATCHED"));
        ArgumentCaptor<OrderActor> actor = ArgumentCaptor.forClass(OrderActor.class);
        verify(service).changeLineSkuMatch(actor.capture(), eq(orderId), eq(lineId), eq(0L), eq(null));
        assertThat(actor.getValue().tenantId()).isEqualTo(tenantId);
        assertThat(actor.getValue().tenantId()).isNotEqualTo(forgedTenant);
        assertThat(actor.getValue().requestId()).isEqualTo("manual-match-1");
    }

    @Test
    void skuMatchEndpointValidatesVersionAndUsesSafeNotFound() throws Exception {
        UUID tenantId = UUID.randomUUID(); UUID orderId = UUID.randomUUID(); UUID lineId = UUID.randomUUID();
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/lines/{lineId}/sku-match", orderId, lineId)
                        .with(authentication(tenantAuthentication(tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"skuId\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details.version").value("invalid"));
        when(service.changeLineSkuMatch(any(), eq(orderId), eq(lineId), eq(0L), eq(null)))
                .thenThrow(new ResourceNotFoundException("private-external-listing-ref"));
        mockMvc.perform(put("/api/v1/order-center/orders/{orderId}/lines/{lineId}/sku-match", orderId, lineId)
                        .with(authentication(tenantAuthentication(tenantId, "orders.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0,\"skuId\":null}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(content().string(not(containsString("private-external-listing-ref"))));
    }

    private static String validRequest(String quantity, String amount, String buyer) {
        String buyerJson = buyer == null ? "null" : "\"" + buyer + "\"";
        return """
                {"shopId":"00000000-0000-0000-0000-000000000010","externalOrderRef":"order-1",
                 "idempotencyKey":"idem-1","currency":"USD","buyerReference":%s,
                 "placedAt":"2026-07-27T00:00:00Z","lines":[{"externalLineRef":"line-1",
                 "titleSnapshot":"Widget","quantity":%s,"unitPriceMinor":%s,"currency":"USD"}]}
                """.formatted(buyerJson, quantity, amount);
    }

    private static OrderAggregate aggregate(UUID tenantId, UUID orderId) {
        TenantOrder order = new TenantOrder(tenantId, UUID.randomUUID(), "order-1", "idem-1", "a".repeat(64),
                "USD", null, 1, Instant.parse("2026-07-27T00:00:00Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        return new OrderAggregate(order, List.of());
    }

    private static OrderListItem summaryItem(UUID shopId) {
        Instant time = Instant.parse("2026-07-27T00:00:00Z");
        return new OrderListItem(
                UUID.randomUUID(), shopId, "Example Shop", null,
                "order-1", "USD", null,
                OrderStatus.RECEIVED, null, 1, time, time, time, 0,
                "OPEN", "PAID", "STANDARD", "US", null, null,
                "STANDARD", 100L, 0L, null, time, null, null,
                null, null, null, false, null, false, false,
                "TXN-001", "CART-001", "INTERNAL-001", "TRACK-001",
                "TRACK-SECONDARY-001", 900L, -50L, 150L,
                800L, 40L, 10L, 20L, 30L, 25L, -5L, 140L,
                "Sales Person", "Order Manager", "Reviewed order remark",
                "VIP", 2, "SUP-001", "Home", "Lighting", "ACTIVE", "Fragile",
                "Order Warehouse", "PICK-A01", "Picker", "Shipper",
                "Purchaser", "Developer",
                time.plusSeconds(1), time.plusSeconds(2),
                time.plusSeconds(3), time.plusSeconds(4), time.plusSeconds(5),
                time.plusSeconds(6), time.plusSeconds(7), time.plusSeconds(8),
                time.plusSeconds(9),
                "SKU-1", "Widget");
    }

    private static OrderAggregate aggregateWithLine(UUID tenantId, UUID orderId, UUID lineId) {
        TenantOrder order = new TenantOrder(tenantId, UUID.randomUUID(), "order-1", "idem-1", "a".repeat(64),
                "USD", null, 1, Instant.parse("2026-07-27T00:00:00Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        OrderLine line = new OrderLine(tenantId, orderId, null, "listing-1", "variant-1",
                SkuMatchSource.UNMATCHED, "line-1", "Widget", 1, 100, "USD");
        ReflectionTestUtils.setField(line, "id", lineId);
        return new OrderAggregate(order, List.of(line));
    }

    private static OrderAggregate aggregateWithMatchedLine(
            UUID tenantId, UUID orderId, UUID lineId, UUID skuId) {
        TenantOrder order = new TenantOrder(
                tenantId, UUID.randomUUID(), "gid://shopify/Order/100",
                "idem-1", "a".repeat(64), "USD", null, 1,
                Instant.parse("2026-07-27T00:00:00Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        OrderLine line = new OrderLine(
                tenantId, orderId, skuId, "line-1", "Widget", 1, 100,
                "USD");
        ReflectionTestUtils.setField(line, "id", lineId);
        return new OrderAggregate(
                order, List.of(line), Map.of(skuId, "SKU-HOSTED-1"));
    }

    private static TestingAuthenticationToken tenantAuthentication(UUID tenantId, String authority) {
        ErpPrincipal principal = new ErpPrincipal(UUID.randomUUID(), Instant.now().plusSeconds(3600), tenantId,
                "tenant", "Tenant", UUID.randomUUID(), "user", "User");
        return new TestingAuthenticationToken(principal, "not-used", authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {
        @Bean OrderCenterService orderCenterService() { return mock(OrderCenterService.class); }
        @Bean cn.xzkj.erp.order.repository.OrderListQueryRepository orderListQueryRepository() {
            return mock(cn.xzkj.erp.order.repository.OrderListQueryRepository.class);
        }
        @Bean OrderCenterController orderCenterController(
                OrderCenterService service,
                cn.xzkj.erp.order.repository.OrderListQueryRepository repository,
                OrderShopifyCatalogPreviewService shopifyCatalogPreviewService,
                OrderShopifyCatalogImportService shopifyCatalogImportService,
                OrderShopifyShippingAddressService shopifyShippingAddressService) {
            return new OrderCenterController(
                    service, repository, shopifyCatalogPreviewService,
                    shopifyCatalogImportService, shopifyShippingAddressService);
        }
        @Bean OrderShopifyCatalogPreviewService orderShopifyCatalogPreviewService() {
            return mock(OrderShopifyCatalogPreviewService.class);
        }
        @Bean OrderShopifyCatalogImportService orderShopifyCatalogImportService() {
            return mock(OrderShopifyCatalogImportService.class);
        }
        @Bean OrderShopifyShippingAddressService orderShopifyShippingAddressService() {
            return mock(OrderShopifyShippingAddressService.class);
        }
        @Bean OrderOperationsService orderOperationsService() {
            return mock(OrderOperationsService.class);
        }
        @Bean OrderOperationsController orderOperationsController(OrderOperationsService service) {
            return new OrderOperationsController(service);
        }
        @Bean FulfillmentService fulfillmentService() {
            return mock(FulfillmentService.class);
        }
        @Bean ShopifyFulfillmentPublicationService shopifyFulfillmentPublicationService() {
            return mock(ShopifyFulfillmentPublicationService.class);
        }
        @Bean FulfillmentController fulfillmentController(
                FulfillmentService service,
                ShopifyFulfillmentPublicationService shopifyPublications,
                LogisticsShipmentService logisticsShipments) {
            return new FulfillmentController(
                    service, shopifyPublications, logisticsShipments);
        }
        @Bean LogisticsShipmentService logisticsShipmentService() {
            return mock(LogisticsShipmentService.class);
        }
        @Bean FulfillmentApiExceptionHandler fulfillmentApiExceptionHandler() {
            return new FulfillmentApiExceptionHandler();
        }
        @Bean OrderApiExceptionHandler orderApiExceptionHandler() { return new OrderApiExceptionHandler(); }
        @Bean AuthSessionRepository authSessionRepository() { return mock(AuthSessionRepository.class); }
        @Bean PermissionRepository permissionRepository() { return mock(PermissionRepository.class); }
        @Bean SessionTokenService sessionTokenService() { return mock(SessionTokenService.class); }
        @Bean BearerTokenAuthenticationFilter bearerTokenAuthenticationFilter(AuthSessionRepository sessions,
                PermissionRepository permissions, SessionTokenService tokens, java.time.Clock clock) {
            return new BearerTokenAuthenticationFilter(sessions, permissions, tokens, clock);
        }
        @Bean TenantContextFilter tenantContextFilter() { return new TenantContextFilter(); }
    }
}
