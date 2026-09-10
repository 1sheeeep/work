package cn.xzkj.erp.order.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.domain.OrderPermissionCodes;
import cn.xzkj.erp.order.service.OrderShopifyCustomerService;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerLocation;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerOrderSummary;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerProfile;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/order-center/shopify/customers")
public class OrderShopifyCustomerController {

    private final OrderShopifyCustomerService customers;

    public OrderShopifyCustomerController(
            OrderShopifyCustomerService customers) {
        this.customers = customers;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public CustomerPageResponse customers(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam @NotNull UUID shopId,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) @Size(max = 4096) String cursor,
            @RequestParam(required = false) @Size(max = 200) String query,
            HttpServletRequest request) {
        var page = customers.customers(
                OrderOperationsController.actor(principal, request),
                shopId, limit, cursor, query);
        return new CustomerPageResponse(
                shopId, page.cursor(), page.hasNextPage(), page.fetchedAt(),
                page.customers().stream().map(CustomerResponse::from).toList());
    }

    public record CustomerPageResponse(
            UUID shopId,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<CustomerResponse> customers) {
    }

    public record CustomerResponse(
            String externalCustomerRef,
            String legacyResourceId,
            String displayName,
            String email,
            String phone,
            Instant createdAt,
            Instant updatedAt,
            boolean verifiedEmail,
            List<String> tags,
            String numberOfOrders,
            MoneyResponse totalSpent,
            CustomerLocationResponse defaultLocation,
            CustomerOrderResponse lastOrder) {
        static CustomerResponse from(CustomerProfile value) {
            return new CustomerResponse(
                    value.externalCustomerRef(), value.legacyResourceId(),
                    value.displayName(), value.email(), value.phone(),
                    value.createdAt(), value.updatedAt(), value.verifiedEmail(),
                    value.tags(), value.numberOfOrders(),
                    MoneyResponse.from(value.totalSpent()),
                    CustomerLocationResponse.from(value.defaultLocation()),
                    CustomerOrderResponse.from(value.lastOrder()));
        }
    }

    public record MoneyResponse(String amount, String currencyCode) {
        static MoneyResponse from(Money value) {
            return value == null ? null
                    : new MoneyResponse(value.amount(), value.currencyCode());
        }
    }

    public record CustomerLocationResponse(
            String city,
            String province,
            String country,
            String countryCode) {
        static CustomerLocationResponse from(CustomerLocation value) {
            return value == null ? null : new CustomerLocationResponse(
                    value.city(), value.province(), value.country(),
                    value.countryCode());
        }
    }

    public record CustomerOrderResponse(
            String externalOrderRef,
            String name,
            Instant createdAt,
            String financialStatus,
            String fulfillmentStatus,
            MoneyResponse total) {
        static CustomerOrderResponse from(CustomerOrderSummary value) {
            return value == null ? null : new CustomerOrderResponse(
                    value.externalOrderRef(), value.name(), value.createdAt(),
                    value.financialStatus(), value.fulfillmentStatus(),
                    MoneyResponse.from(value.total()));
        }
    }
}
