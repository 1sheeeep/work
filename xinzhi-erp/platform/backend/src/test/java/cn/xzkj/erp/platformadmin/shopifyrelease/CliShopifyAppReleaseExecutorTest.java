package cn.xzkj.erp.platformadmin.shopifyrelease;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

class CliShopifyAppReleaseExecutorTest {
    @Test
    void backendImageIncludesTheCompleteShopifyCliProject() throws IOException {
        String dockerfile = Files.readString(Path.of("Dockerfile"));

        assertThat(dockerfile)
                .contains(
                        "customer-service/package.json /opt/xz-erp/shopify/package.json",
                        "customer-service/package-lock.json /opt/xz-erp/shopify/package-lock.json",
                        "customer-service/shopify.app.toml /opt/xz-erp/shopify/shopify.app.toml",
                        "customer-service/extensions/xinzhi-support-chat /opt/xz-erp/shopify/extensions/xinzhi-support-chat");
    }

    @Test
    void usesTheSafeNonInteractiveUpdateFlagWithoutAllowingDeletes() {
        CliShopifyAppReleaseExecutor executor =
                new CliShopifyAppReleaseExecutor(
                        "shopify-test", ".", Duration.ofMinutes(1));

        List<String> command = executor.deployCommand(
                Path.of("release-workspace"), "xinzhi-erp-test");

        assertThat(command)
                .contains("app", "deploy", "--allow-updates")
                .doesNotContain("--allow-deletes", "--no-release");
    }

    @Test
    void convertsTheMissingNonInteractiveFlagOutputToAReadableMessage() {
        String message = CliShopifyAppReleaseExecutor.releaseFailureMessage(
                "Flag not specified: --allow-updates or --allow-deletes");

        assertThat(message).isEqualTo(
                "Shopify 发布参数不完整，请更新 ERP 发布组件后重试。");
    }
}
