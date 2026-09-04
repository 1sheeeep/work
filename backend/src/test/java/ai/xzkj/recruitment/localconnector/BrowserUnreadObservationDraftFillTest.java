package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BrowserUnreadObservationDraftFillTest {
    @Test
    void approvedKnowledgeDraftUsesOneShortFillClaimWithoutSending() {
        BrowserDevice device = mock(BrowserDevice.class);
        BossAccount account = mock(BossAccount.class);
        when(device.getBossAccount()).thenReturn(account);
        Instant now = Instant.parse("2026-08-31T12:00:00Z");
        BrowserUnreadObservation observation = new BrowserUnreadObservation(device, "a".repeat(64), now, now);
        observation.prepareDraft("KNOWLEDGE", "安全草稿", "已审核", "KNOWLEDGE_READY", UUID.randomUUID(), List.of(), 1, 1, now);
        observation.review("APPROVED", "安全草稿", null, mock(SystemUser.class), now);

        UUID deviceId = UUID.randomUUID();
        observation.claimDraftFill("b".repeat(64), "c".repeat(64), deviceId, now.plusSeconds(60), now);
        assertThat(observation.getDraftFillStatus()).isEqualTo("CLAIMED");
        observation.completeDraftFill("b".repeat(64), "c".repeat(64), "FILLED", now.plusSeconds(5));
        assertThat(observation.getDraftFillStatus()).isEqualTo("FILLED");
        assertThat(observation.getDraftFilledAt()).isEqualTo(now.plusSeconds(5));
        assertThatThrownBy(() -> observation.completeDraftFill("b".repeat(64), "c".repeat(64), "FILLED", now.plusSeconds(6)))
                .hasMessageContaining("已使用");
    }

    @Test
    void expiredClaimFreezesResultAsUnknown() {
        BrowserDevice device = mock(BrowserDevice.class);
        when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now = Instant.parse("2026-08-31T12:00:00Z");
        BrowserUnreadObservation observation = new BrowserUnreadObservation(device, "a".repeat(64), now, now);
        observation.prepareDraft("KNOWLEDGE", "安全草稿", "已审核", "KNOWLEDGE_READY", UUID.randomUUID(), List.of(), 1, 1, now);
        observation.review("APPROVED", "安全草稿", null, mock(SystemUser.class), now);
        observation.claimDraftFill("b".repeat(64), "c".repeat(64), UUID.randomUUID(), now.plusSeconds(60), now);

        assertThatThrownBy(() -> observation.completeDraftFill("b".repeat(64), "c".repeat(64), "FILLED", now.plusSeconds(61)))
                .hasMessageContaining("过期");
        assertThat(observation.getDraftFillStatus()).isEqualTo("UNKNOWN");
    }

    @Test
    void watchdogCanFreezeAnExpiredClaimWithoutRepeatingTheFill() {
        BrowserDevice device = mock(BrowserDevice.class);
        when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now = Instant.parse("2026-08-31T12:00:00Z");
        BrowserUnreadObservation observation = new BrowserUnreadObservation(device, "a".repeat(64), now, now);
        observation.prepareDraft("KNOWLEDGE", "安全草稿", "已审核", "KNOWLEDGE_READY", UUID.randomUUID(), List.of(), 1, 1, now);
        observation.review("APPROVED", "安全草稿", null, mock(SystemUser.class), now);
        observation.claimDraftFill("b".repeat(64), "c".repeat(64), UUID.randomUUID(), now.plusSeconds(60), now);

        assertThat(observation.expireDraftFill(now.plusSeconds(61))).isTrue();
        assertThat(observation.getDraftFillStatus()).isEqualTo("UNKNOWN");
        assertThatThrownBy(() -> observation.claimDraftFill("d".repeat(64), "e".repeat(64), UUID.randomUUID(), now.plusSeconds(120), now.plusSeconds(61)))
                .hasMessageContaining("尚未通过");
    }
}
