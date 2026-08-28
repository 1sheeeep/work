package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MockBossGatewayTest {
    private final MockBossGateway gateway = new MockBossGateway();
    private final Company company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);

    @Test
    void fullProfileReturnsEveryCapability() {
        var result = gateway.inspect(new BossAccount(company, "账号", "full", MockBossProfile.FULL));

        assertThat(result.status()).isEqualTo(BossConnectionStatus.CONNECTED);
        assertThat(result.capabilities()).containsExactlyInAnyOrder(BossCapability.values());
    }

    @Test
    void unavailableProfileReturnsNoCapabilities() {
        var result = gateway.inspect(new BossAccount(company, "账号", "down", MockBossProfile.UNAVAILABLE));

        assertThat(result.status()).isEqualTo(BossConnectionStatus.UNAVAILABLE);
        assertThat(result.capabilities()).isEmpty();
    }
}
