package cn.xzkj.erp.system;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.entry.FirstPartyApplicationOriginRegistry;
import java.util.Map;

import org.junit.jupiter.api.Test;

class SystemInfoControllerTest {

    @Test
    void exposesSafeBootstrapMetadata() {
        SystemInfoController controller = new SystemInfoController(
                "test",
                new FirstPartyApplicationOriginRegistry(
                        "https://erp.example.test",
                        "https://zhaoyaojing.example.test",
                        "https://asset.example.test",
                        "test"));

        Map<String, Object> info = controller.info();

        assertThat(info)
                .containsEntry("service", "xz-erp")
                .containsEntry("status", "ready")
                .containsEntry("environment", "test")
                .doesNotContainKey("customerServiceMigration");
        Map<?, ?> applications = (Map<?, ?>) info.get("firstPartyApplications");
        assertThat(applications.get("ONE")).isNull();
        assertThat(info.get("identityMode")).isEqualTo("local");
        assertThat(applications.get("ERP")).isEqualTo("https://erp.example.test");
        assertThat(info).doesNotContainKeys("password", "token", "secret");
    }
}
