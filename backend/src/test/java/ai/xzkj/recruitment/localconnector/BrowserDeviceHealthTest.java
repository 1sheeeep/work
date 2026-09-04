package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class BrowserDeviceHealthTest {
    private final BrowserDevice device = new BrowserDevice(
            mock(BossAccount.class), "Chrome 只读桥接", "a".repeat(64),
            "BROWSER_READONLY_BRIDGE", "0.6.0", mock(SystemUser.class));

    @Test
    void requiresANewChatSnapshotBeforeConfirmingRecovery() {
        Instant pausedAt = Instant.parse("2026-08-31T10:00:00Z");
        device.heartbeat("PAUSED", "BOSS 页面脚本尚未就绪", "CHAT", pausedAt);
        device.heartbeat("RUNNING", "页面重新打开", "CHAT", pausedAt.plusSeconds(10));

        assertThat(device.getRecoveryRequiredSince()).isEqualTo(pausedAt);
        assertThat(device.getLastRecoveredAt()).isNull();

        assertThat(device.recordSuccessfulSync("CHAT", pausedAt.plusSeconds(20))).isTrue();
        assertThat(device.getRecoveryRequiredSince()).isNull();
        assertThat(device.getLastRecoveredAt()).isEqualTo(pausedAt.plusSeconds(20));
        assertThat(device.getLastSuccessfulChatSyncAt()).isEqualTo(pausedAt.plusSeconds(20));
        assertThat(DeviceResponse.from(device).recoveryStatus()).isEqualTo("RECOLLECTED");
    }

    @Test
    void jobSyncDoesNotClearAChatRecoveryRequirement() {
        Instant pausedAt = Instant.parse("2026-08-31T10:00:00Z");
        device.heartbeat("PAUSED", "未找到已打开的 BOSS 沟通页", "JOB_LIST", pausedAt);

        assertThat(device.recordSuccessfulSync("JOB", pausedAt.plusSeconds(20))).isFalse();
        assertThat(device.getRecoveryRequiredSince()).isEqualTo(pausedAt);
        assertThat(device.getLastSuccessfulJobSyncAt()).isEqualTo(pausedAt.plusSeconds(20));
        assertThat(device.getLastRecoveredAt()).isNull();
        assertThat(DeviceResponse.from(device).recoveryStatus()).isEqualTo("WAITING_RECOLLECTION");
    }
}
