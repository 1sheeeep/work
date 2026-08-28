package ai.xzkj.recruitment.notifications;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationPropertiesTest {
    @Test void productionModeAllowsRecipientsWhenTrialRestrictionIsDisabled() {
        var properties = new NotificationProperties("WEBHOOK", "https://hr.example/hooks", "secret",
                Duration.ofSeconds(2), false, false, null);
        assertThat(properties.trialRecipientAllowed(UUID.randomUUID())).isTrue();
    }

    @Test void trialModeRestrictsRecipientsToConfiguredWhitelist() {
        UUID allowed = UUID.randomUUID();
        var properties = new NotificationProperties("WEBHOOK", "https://hr.example/hooks", "secret",
                Duration.ofSeconds(2), false, true, allowed.toString());
        assertThat(properties.trialRecipientAllowed(allowed)).isTrue();
        assertThat(properties.trialRecipientAllowed(UUID.randomUUID())).isFalse();
    }
}
