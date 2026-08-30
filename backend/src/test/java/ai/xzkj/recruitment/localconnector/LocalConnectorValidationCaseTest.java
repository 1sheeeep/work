package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.mock;

class LocalConnectorValidationCaseTest {
    private final BrowserDevice device=mock(BrowserDevice.class);
    private final SystemUser user=mock(SystemUser.class);
    private final Instant now=Instant.parse("2026-08-30T10:00:00Z");

    @Test void requiresFreshReadinessBeforeStarting(){LocalConnectorValidationCase v=validation();assertThatThrownBy(()->v.start(user,now)).hasMessage("页面尚未准备完成");v.prepare("a".repeat(64),"b".repeat(64),now.minusSeconds(121));assertThatThrownBy(()->v.start(user,now)).hasMessage("页面就绪证据已过期");}
    @Test void passesOnlyInsideTheManualWindow(){LocalConnectorValidationCase v=validation();v.prepare("a".repeat(64),"b".repeat(64),now);v.start(user,now);v.complete(true,"页面出现一次明确成功回执",user,now.plusSeconds(30));assertThat(v.getStatus()).isEqualTo("PASSED");assertThat(v.getResultNote()).isEqualTo("页面出现一次明确成功回执");}
    @Test void expiresAndFailsClosed(){LocalConnectorValidationCase v=validation();v.prepare("a".repeat(64),"b".repeat(64),now);v.start(user,now);v.complete(true,"迟到的成功确认",user,now.plusSeconds(601));assertThat(v.getStatus()).isEqualTo("FAILED");assertThat(v.getLastFailureReason()).isEqualTo("人工验收窗口已过期");}
    private LocalConnectorValidationCase validation(){return new LocalConnectorValidationCase(device,"SEND_MESSAGE","前置条件","预期结果");}
}
