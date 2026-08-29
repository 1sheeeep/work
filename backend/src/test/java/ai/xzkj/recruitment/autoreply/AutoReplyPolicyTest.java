package ai.xzkj.recruitment.autoreply;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;
import java.time.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class AutoReplyPolicyTest {
    @Test void maintainsIndependentDailyQuotaAndMinimumInterval() {
        var policy = policy(30, 2);
        Instant now = Instant.parse("2026-08-28T02:00:00Z");
        policy.prepareQuota(LocalDate.of(2026, 8, 28));
        policy.sent(now);
        assertThat(policy.getSentToday()).isEqualTo(1);
        assertThat(policy.intervalElapsed(now.plusSeconds(29))).isFalse();
        assertThat(policy.intervalElapsed(now.plusSeconds(30))).isTrue();
        policy.prepareQuota(LocalDate.of(2026, 8, 29));
        assertThat(policy.getSentToday()).isZero();
    }

    @Test void pausesOnlyThisAccountAfterConfiguredFailures() {
        var policy = policy(30, 2);
        Instant now = Instant.parse("2026-08-28T02:00:00Z");
        policy.failed(now); assertThat(policy.getPausedUntil()).isNull();
        policy.failed(now); assertThat(policy.getPausedUntil()).isEqualTo(now.plus(Duration.ofHours(24)));
        assertThat(policy.canSend(now.plus(Duration.ofHours(1)))).isFalse();
    }

    @Test void stopsSendingWhenAwayPeriodExpires() {
        var user = mock(SystemUser.class); var account = mock(BossAccount.class);
        var policy = new AutoReplyPolicy(account, user, AutoReplyService.DEFAULT_TEMPLATE);
        Instant end = Instant.now().plus(Duration.ofHours(1));
        policy.update(true, AwayMode.TEMPORARY, end, true, 120, 20, 30,
                LocalTime.of(9,0), LocalTime.of(21,0), "Asia/Shanghai", 2,
                AutoReplyService.DEFAULT_TEMPLATE, user);
        assertThat(policy.canSend(end.minusSeconds(1))).isTrue();
        assertThat(policy.canSend(end)).isFalse();
    }

    private AutoReplyPolicy policy(int interval, int maxFailures) {
        var user = mock(SystemUser.class); var account = mock(BossAccount.class);
        var policy = new AutoReplyPolicy(account, user, AutoReplyService.DEFAULT_TEMPLATE);
        policy.update(true, AwayMode.TEMPORARY, Instant.now().plus(Duration.ofHours(2)), true, 120, 20, interval, LocalTime.of(9,0), LocalTime.of(21,0),
                "Asia/Shanghai", maxFailures, AutoReplyService.DEFAULT_TEMPLATE, user);
        return policy;
    }
}
