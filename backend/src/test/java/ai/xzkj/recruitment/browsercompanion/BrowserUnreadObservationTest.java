package ai.xzkj.recruitment.browsercompanion;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BrowserUnreadObservationTest {
    private static final String DIGEST="a".repeat(64);

    @Test void confirmsHrReplyAfterFilledDraftAndResetsForNextInboundCycle(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),now=first.plusSeconds(10);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);
        observation.verifyDetail("b".repeat(64),"INBOUND",first,true,first);
        observation.review("APPROVED","已收到您的消息",null,mock(SystemUser.class),first);
        assertThat(observation.claimFill(device,first)).isTrue();
        observation.finishFill("FILLED",now);

        observation.verifyDetail("c".repeat(64),"OUTBOUND",now,false,now);
        observation.evaluate(now,120,true);

        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getResolutionStatus()).isEqualTo("HR_SENT_AFTER_DRAFT");
        assertThat(observation.getResolvedAt()).isEqualTo(now);
        assertThat(observation.getEligibilityStatus()).isEqualTo("HR_HANDLED");

        Instant next=now.plusSeconds(60);
        observation.observe(entry(1,next),next);

        assertThat(observation.isUnread()).isTrue();
        assertThat(observation.getResolutionStatus()).isEqualTo("UNRESOLVED");
        assertThat(observation.getReviewStatus()).isEqualTo("PENDING");
        assertThat(observation.getFillStatus()).isEqualTo("NONE");
        assertThat(observation.getLatestDirection()).isNull();
    }

    private UnreadObservationEntry entry(int unread,Instant at){return new UnreadObservationEntry(DIGEST,null,null,null,null,unread,at,at);}
}
