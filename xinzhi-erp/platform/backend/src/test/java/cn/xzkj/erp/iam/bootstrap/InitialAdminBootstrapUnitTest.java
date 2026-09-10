package cn.xzkj.erp.iam.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.ErpApplication;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;

class InitialAdminBootstrapUnitTest {

    @Test
    void tenantAdminGrantContractIsExplicitUniqueAndExactlySeventySixCodes() {
        assertThat(TenantAdminPermissionCodes.EXACT_CODES)
                .hasSize(76)
                .doesNotHaveDuplicates()
                .containsExactly(
                        "platform:read",
                        "platform:write",
                        "shop:read",
                        "shop:write",
                        "shop:authorization:write",
                        "shop:sync:read",
                        "shop:sync:write",
                        "iam:user:read",
                        "iam:user:write",
                        "iam:role:read",
                        "iam:role:write",
                        "iam:permission:read",
                        "iam:permission:assign",
                        "iam:audit:read",
                        "iam:warehouse:scope:read",
                        "iam:warehouse:scope:write",
                        "products.read",
                        "products.write",
                        "products.listing.read",
                        "products.listing.write",
                        "products.master_data.read",
                        "products.master_data.write",
                        "products.weight.write",
                        "inventory.shopify.publish",
                        "inventory.read",
                        "inventory.adjust",
                        "inventory.manual.configure",
                        "inventory.manual.write",
                        "inventory.manual.approve",
                        "inventory.manual.post",
                        "inventory.reverse",
                        "orders.read",
                        "orders.write",
                        "orders.shopify_edit.write",
                        "customer_service.read",
                        "customer_service.conversation.claim",
                        "customer_service.conversation.reply",
                        "customer_service.conversation.transfer",
                        "customer_service.conversation.close",
                        "customer_service.ticket.manage",
                        "fulfillments.read",
                        "fulfillments.allocate.write",
                        "fulfillments.pick.write",
                        "fulfillments.pack.write",
                        "fulfillments.ship.write",
                        "fulfillments.ship.correct.write",
                        "fulfillments.weigh.override",
                        "fulfillments.cancel.write",
                        "fulfillments.exception.write",
                        "orders.transfer.read",
                        "orders.transfer.write",
                        "logistics.read",
                        "logistics.address.write",
                        "logistics.declaration_entity.write",
                        "logistics.tracking_number.write",
                        "logistics.shipping_fee.write",
                        "logistics.label_template.write",
                        "logistics.matching_rule.write",
                        "logistics.authorization.write",
                        "logistics.forecast.write",
                        "logistics.fee.write",
                        "logistics.inquiry.write",
                        "suppliers.read",
                        "suppliers.write",
                        "procurement.read",
                        "procurement.write",
                        "finance.read",
                        "analytics.read",
                        "warehouses.read",
                        "warehouses.write",
                        "warehouses.shipping_config.write",
                        "settings.read",
                        "settings.task.write",
                        "settings.notice.write",
                        "settings.enterprise.write",
                        "settings.parameter.write");
    }

    @Test
    void propertiesRequireBoundedValidatedExplicitInputs() {
        InitialAdminBootstrapProperties properties = validProperties();
        InitialAdminBootstrapCommand command = properties.toCommand();
        assertThat(command.tenantCode()).isEqualTo("acme");
        assertThat(command.tenantName()).isEqualTo("ACME Tenant");
        assertThat(command.email()).isEqualTo("initial.admin@example.com");
        assertThat(command.displayName()).isEqualTo("Initial Admin");
        assertThat(command.tokenOutputPath()).isAbsolute();
        assertThat(command.ttlMinutes()).isEqualTo(30);

        properties.setTtlMinutes(121);
        assertThatThrownBy(properties::toCommand)
                .isExactlyInstanceOf(InitialAdminBootstrapException.class)
                .hasMessage("Initial administrator bootstrap failed safely");

        properties = validProperties();
        properties.setTokenOutputPath("relative-token.txt");
        assertThatThrownBy(properties::toCommand)
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);

        properties = validProperties();
        properties.setTenantCode("INVALID!");
        assertThatThrownBy(properties::toCommand)
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);
    }

    @Test
    void enabledBootstrapRequiresExplicitNonWebModeBeforeContextStarts() {
        InitialAdminBootstrapEnvironmentPostProcessor processor =
                new InitialAdminBootstrapEnvironmentPostProcessor();
        SpringApplication application =
                new SpringApplication(ErpApplication.class);

        processor.postProcessEnvironment(
                new MockEnvironment(),
                application);

        MockEnvironment enabledWeb = new MockEnvironment()
                .withProperty(
                        "erp.bootstrap.initial-admin.enabled",
                        "true");
        assertThatThrownBy(() -> processor.postProcessEnvironment(
                enabledWeb,
                application))
                .isExactlyInstanceOf(InitialAdminBootstrapException.class);

        MockEnvironment enabledNonWeb = new MockEnvironment()
                .withProperty(
                        "erp.bootstrap.initial-admin.enabled",
                        "true")
                .withProperty(
                        "spring.main.web-application-type",
                        "none");
        processor.postProcessEnvironment(enabledNonWeb, application);
    }

    private static InitialAdminBootstrapProperties validProperties() {
        InitialAdminBootstrapProperties properties =
                new InitialAdminBootstrapProperties();
        properties.setTenantCode("acme");
        properties.setTenantName(" ACME Tenant ");
        properties.setEmail("Initial.Admin@Example.com");
        properties.setDisplayName(" Initial Admin ");
        properties.setTokenOutputPath(
                Path.of(System.getProperty("java.io.tmpdir"), "activation.token")
                        .toAbsolutePath()
                        .toString());
        properties.setTtlMinutes(30);
        return properties;
    }
}
