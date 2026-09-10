package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CustomerServiceOverviewServiceTest {

    private static final UUID TENANT_ID =
            UUID.fromString("10000000-0000-4000-8000-000000000001");

    @Test
    void summarizesOnlyTenantShopAndAuthorizationFacts() {
        CustomerServiceShopProjectionProvider provider = tenantId -> List.of(
                shop("ACTIVE", "AUTHORIZED", true),
                shop("ACTIVE", "AUTHORIZED", false),
                shop("SUSPENDED", "ERROR", false),
                shop("ACTIVE", "NOT_AUTHORIZED", false));

        var overview = new CustomerServiceOverviewService(provider).summarize(TENANT_ID);

        assertThat(overview).isEqualTo(new CustomerServiceOverviewService.Overview(
                4,
                3,
                2,
                1,
                3));
    }

    @Test
    void returnsZeroesForAnEmptyTenant() {
        var overview = new CustomerServiceOverviewService(tenantId -> List.of())
                .summarize(TENANT_ID);

        assertThat(overview).isEqualTo(new CustomerServiceOverviewService.Overview(
                0,
                0,
                0,
                0,
                0));
    }

    private static CustomerServiceShopProjectionProvider.ShopProjection shop(
            String status,
            String authorizationStatus,
            boolean credentialConfigured) {
        return new CustomerServiceShopProjectionProvider.ShopProjection(
                UUID.randomUUID(),
                "Shop",
                "shop.myshopify.com",
                status,
                authorizationStatus,
                credentialConfigured,
                credentialConfigured ? "XZ_ERP_APP" : "UNCONFIGURED");
    }
}
