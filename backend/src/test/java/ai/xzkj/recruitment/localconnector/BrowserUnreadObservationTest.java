package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BrowserUnreadObservationTest {
    private static final String DIGEST="a".repeat(64);

    @Test void confirmsHrReplyAndResetsForNextInboundCycle(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),now=first.plusSeconds(10);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);
        observation.verifyDetail("b".repeat(64),"INBOUND",first,true,first);
        observation.review("APPROVED","已收到您的消息",null,mock(SystemUser.class),first);
        observation.verifyDetail("c".repeat(64),"OUTBOUND",now,false,now);
        observation.evaluate(now,120,true);

        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getResolutionStatus()).isEqualTo("HR_REPLIED");
        assertThat(observation.getResolvedAt()).isEqualTo(now);
        assertThat(observation.getEligibilityStatus()).isEqualTo("HR_HANDLED");

        Instant next=now.plusSeconds(60);
        observation.observe(entry(1,next),next);

        assertThat(observation.isUnread()).isTrue();
        assertThat(observation.getResolutionStatus()).isEqualTo("UNRESOLVED");
        assertThat(observation.getReviewStatus()).isEqualTo("PENDING");
        assertThat(observation.getLatestDirection()).isNull();
    }

    @Test void closesAnUnreadObservationWhenTheStableListReportsItRead(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);

        observation.observe(entry(0,first.plusSeconds(30)),first.plusSeconds(30));
        observation.evaluate(first.plusSeconds(30),120,true);

        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getEligibilityStatus()).isEqualTo("HR_HANDLED");
    }

    @Test void archivesUnreadStateWhenItsConnectorDeviceHasBeenReplaced(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),replaced=first.plusSeconds(60);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(2,first),first);

        observation.archiveReplacedSource(replaced);

        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getUnreadCount()).isZero();
        assertThat(observation.getEligibilityStatus()).isEqualTo("HR_HANDLED");
        assertThat(observation.getResolutionStatus()).isEqualTo("SOURCE_REPLACED");
        assertThat(observation.getResolvedAt()).isEqualTo(replaced);
    }

    @Test void blocksDraftEligibilityWhenConversationIsMissingFromLatestPartialSnapshot(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),missing=first.plusSeconds(120);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);
        observation.verifyDetail("b".repeat(64),"INBOUND",first,true,first);

        observation.markMissingFromLatestSnapshot(missing);

        assertThat(observation.isUnread()).isTrue();
        assertThat(observation.getEligibilityStatus()).isEqualTo("SNAPSHOT_CONFIRMATION_REQUIRED");
        assertThat(observation.getLatestDirection()).isNull();

        observation.observe(entry(1,missing.plusSeconds(30)),missing.plusSeconds(30));
        observation.evaluate(missing.plusSeconds(30),1,true);
        assertThat(observation.getEligibilityStatus()).isEqualTo("DETAIL_REQUIRED");
    }

    @Test void keepsConversationPendingWhenOpeningItClearsTheBadgeButLatestMessageIsInbound(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),opened=first.plusSeconds(30);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);
        observation.observe(entry(0,opened),opened);

        observation.verifyDetail("b".repeat(64),"INBOUND",first,false,opened);
        observation.evaluate(opened,120,true);

        assertThat(observation.isUnread()).isTrue();
        assertThat(observation.getUnreadCount()).isOne();
        assertThat(observation.getResolutionStatus()).isEqualTo("UNRESOLVED");
        assertThat(observation.getLatestDirection()).isEqualTo("INBOUND");
        assertThat(observation.getEligibilityStatus()).isEqualTo("OBSERVING");
    }

    @Test void movesAReappearingConversationToTheCurrentBridgeDevice(){
        BrowserDevice oldDevice=mock(BrowserDevice.class),currentDevice=mock(BrowserDevice.class);
        BossAccount account=mock(BossAccount.class);
        when(oldDevice.getBossAccount()).thenReturn(account);when(currentDevice.getBossAccount()).thenReturn(account);
        Instant first=Instant.parse("2026-08-29T12:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(oldDevice,DIGEST,first,first);

        observation.attachSource(currentDevice);

        assertThat(observation.getDevice()).isSameAs(currentDevice);
        assertThat(observation.getAccount()).isSameAs(account);
    }

    @Test void storesStructuredDraftQualificationAndKnowledgeVersions(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-08-30T12:00:00Z");UUID jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);

        observation.prepareDraft("GENERIC","已收到","资料待完善","KNOWLEDGE_BLOCKED",jobId,
                List.of("COMPANY_KNOWLEDGE_UNAPPROVED","JOB_KNOWLEDGE_UNAPPROVED"),2,3,now);

        assertThat(observation.getDraftQualification()).isEqualTo("KNOWLEDGE_BLOCKED");
        assertThat(observation.getMatchedJobPositionId()).isEqualTo(jobId);
        assertThat(observation.getDraftBlockerCodes()).containsExactly("COMPANY_KNOWLEDGE_UNAPPROVED","JOB_KNOWLEDGE_UNAPPROVED");
        assertThat(observation.getDraftCompanyKnowledgeVersion()).isEqualTo(2);
        assertThat(observation.getDraftJobKnowledgeVersion()).isEqualTo(3);
    }

    private UnreadObservationEntry entry(int unread,Instant at){return new UnreadObservationEntry(DIGEST,null,null,null,null,unread,at,at);}
}
