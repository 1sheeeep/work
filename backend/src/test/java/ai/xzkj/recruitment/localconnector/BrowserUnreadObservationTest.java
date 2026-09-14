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

    @Test void advancesAnExplicitReadConversationCycleAndStopsForHumanInterview(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        SystemUser hr=mock(SystemUser.class);
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.prepareDraft("KNOWLEDGE","已收到您的消息","已匹配岗位","KNOWLEDGE_READY",UUID.randomUUID(),List.of(),1,1,now);
        observation.verifyDetail("b".repeat(64),"OUTBOUND",now,false,ConversationSignals.none(),now);

        observation.startCycleTest("已收到您的消息",hr,now.plusSeconds(1));
        assertThat(observation.getConversationStage()).isEqualTo("INITIAL_CONTACT");
        observation.recordActionOutcome("SEND_MESSAGE","SUCCEEDED",now.plusSeconds(2));
        assertThat(observation.getConversationStage()).isEqualTo("AWAITING_REPLY");

        observation.verifyDetail("c".repeat(64),"INBOUND",now.plusSeconds(3),false,
                new ConversationSignals(true,false,false,false,false,false,false,false),now.plusSeconds(3));
        assertThat(observation.getConversationStage()).isEqualTo("CAN_REQUEST_RESUME");
        observation.recordActionOutcome("REQUEST_RESUME","SUCCEEDED",now.plusSeconds(4));
        assertThat(observation.getConversationStage()).isEqualTo("RESUME_REQUESTED");

        observation.verifyDetail("d".repeat(64),"INBOUND",now.plusSeconds(5),false,
                new ConversationSignals(false,true,true,true,false,false,false,false),now.plusSeconds(5));
        assertThat(observation.getCycleTestStatus()).isEqualTo("WAITING_RESUME_REVIEW");
        assertThat(observation.getConversationStage()).isEqualTo("RESUME_RECEIVED");

        observation.reviewCycleResume("APPROVED",hr,"简历匹配，可交换联系方式",now.plusSeconds(6));
        assertThat(observation.getConversationStage()).isEqualTo("CAN_EXCHANGE_CONTACT");
        observation.recordActionOutcome("EXCHANGE_WECHAT","SUCCEEDED",now.plusSeconds(7));
        assertThat(observation.getConversationStage()).isEqualTo("CONTACT_EXCHANGED");
        assertThat(observation.getCycleTestStatus()).isEqualTo("WAITING_HUMAN_INTERVIEW");
        assertThat(observation.getResolutionStatus()).isEqualTo("HUMAN_TAKEOVER");
    }

    @Test void derivesConversationStageFromPositiveDomSignals(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.verifyDetail("b".repeat(64),"OUTBOUND",now,false,
                new ConversationSignals(true,false,true,false,false,true,true,false),now);
        assertThat(observation.getConversationStage()).isEqualTo("CAN_REQUEST_RESUME");

        observation.verifyDetail("c".repeat(64),"OUTBOUND",now,false,
                new ConversationSignals(false,true,true,false,false,false,true,false),now);
        assertThat(observation.getConversationStage()).isEqualTo("CAN_SCHEDULE_INTERVIEW");

        observation.verifyDetail("d".repeat(64),"OUTBOUND",now,false,
                new ConversationSignals(false,true,false,false,true,false,true,true),now);
        assertThat(observation.getConversationStage()).isEqualTo("INTERVIEW_SCHEDULED");
    }

    @Test void keepsConfirmedResumeMilestoneWhenAFormerControlDisappears(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);

        observation.verifyDetail("b".repeat(64),"INBOUND",now,false,
                new ConversationSignals(false,true,false,false,false,false,false,false),now);
        observation.verifyDetail("c".repeat(64),"INBOUND",now.plusSeconds(1),false,
                ConversationSignals.none(),now.plusSeconds(1));

        assertThat(observation.getConversationSignals().resumeReceived()).isTrue();
        assertThat(observation.getResumePipelineStatus()).isEqualTo("DETECTED");
    }

    @Test void keepsInterviewScheduledAsATerminalMilestoneAndClosesLaterUnreadMessages(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.verifyDetail("b".repeat(64),"OUTBOUND",now,false,
                new ConversationSignals(false,true,false,false,true,false,true,true),now);

        observation.verifyDetail("c".repeat(64),"INBOUND",now.plusSeconds(60),true,
                ConversationSignals.none(),now.plusSeconds(60));

        assertThat(observation.getConversationStage()).isEqualTo("INTERVIEW_SCHEDULED");
        assertThat(observation.getConversationSignals().interviewScheduled()).isTrue();
        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getUnreadCount()).isZero();
        assertThat(observation.getEligibilityStatus()).isEqualTo("HUMAN_TAKEOVER");
        assertThat(observation.getResolutionStatus()).isEqualTo("HUMAN_TAKEOVER");
    }

    @Test void keepsInitialContactUntilTheAutomaticReplyHasSucceeded(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        SystemUser hr=mock(SystemUser.class);
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.prepareDraft("KNOWLEDGE","已收到您的消息","已匹配岗位","KNOWLEDGE_READY",UUID.randomUUID(),List.of(),1,1,now);
        observation.verifyDetail("b".repeat(64),"OUTBOUND",now,false,ConversationSignals.none(),now);
        observation.startCycleTest("已收到您的消息",hr,now.plusSeconds(1));

        observation.verifyDetail("c".repeat(64),"OUTBOUND",now.plusSeconds(2),false,
                new ConversationSignals(true,false,false,false,false,false,false,false),now.plusSeconds(2));

        assertThat(observation.getConversationStage()).isEqualTo("INITIAL_CONTACT");
    }

    @Test void cancelsAnActiveCycleAndAllowsItToBeStartedAgain(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        SystemUser hr=mock(SystemUser.class);
        Instant now=Instant.parse("2026-09-06T10:00:00Z");
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.prepareDraft("KNOWLEDGE","已收到您的消息","已匹配岗位","KNOWLEDGE_READY",UUID.randomUUID(),List.of(),1,1,now);
        observation.verifyDetail("b".repeat(64),"OUTBOUND",now,false,ConversationSignals.none(),now);
        observation.startCycleTest("已收到您的消息",hr,now.plusSeconds(1));

        observation.cancelCycleTest(hr,"测试取消",now.plusSeconds(2));

        assertThat(observation.getCycleTestStatus()).isEqualTo("CANCELLED");
        assertThat(observation.getResolutionStatus()).isEqualTo("HUMAN_TAKEOVER");
        observation.verifyDetail("c".repeat(64),"OUTBOUND",now.plusSeconds(3),false,ConversationSignals.none(),now.plusSeconds(3));
        observation.startCycleTest("重新开始",hr,now.plusSeconds(4));
        assertThat(observation.getCycleTestStatus()).isEqualTo("ACTIVE");
        assertThat(observation.getConversationStage()).isEqualTo("INITIAL_CONTACT");
    }

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

    @Test void keepsReadConversationReviewableWhenVerifiedLastMessageIsInbound(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant first=Instant.parse("2026-08-29T12:00:00Z"),now=first.plusSeconds(30);
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,first,first);
        observation.observe(entry(1,first),first);
        observation.verifyDetail("b".repeat(64),"INBOUND",first,true,first);

        observation.observe(entry(0,now),now);
        observation.evaluate(now,0,true);

        assertThat(observation.isUnread()).isFalse();
        assertThat(observation.getLatestDirection()).isEqualTo("INBOUND");
        assertThat(observation.getEligibilityStatus()).isEqualTo("READY_FOR_REVIEW");
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

    @Test void invalidatesApprovalWhenKnowledgeBackedDraftChanges(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-08-30T12:00:00Z");UUID jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.prepareDraft("KNOWLEDGE","第一版草稿","已使用审核资料","KNOWLEDGE_READY",jobId,List.of(),1,1,now);
        observation.review("APPROVED","第一版草稿",null,mock(SystemUser.class),now);

        observation.prepareDraft("KNOWLEDGE","第二版草稿","已使用审核资料","KNOWLEDGE_READY",jobId,List.of(),2,1,now.plusSeconds(60));

        assertThat(observation.getReviewStatus()).isEqualTo("PENDING");
        assertThat(observation.getReviewedContent()).isNull();
        assertThat(observation.getReviewNote()).contains("原草稿批准已自动失效");
        assertThat(observation.getDraftCompanyKnowledgeVersion()).isEqualTo(2);
    }

    @Test void keepsApprovalWhenRecalculationProducesTheSameDraftSnapshot(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-08-30T12:00:00Z");UUID jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);
        observation.prepareDraft("KNOWLEDGE","稳定草稿","已使用审核资料","KNOWLEDGE_READY",jobId,List.of(),1,1,now);
        observation.review("APPROVED","HR 核对后的稳定草稿",null,mock(SystemUser.class),now);

        observation.prepareDraft("KNOWLEDGE","稳定草稿","已使用审核资料","KNOWLEDGE_READY",jobId,List.of(),1,1,now.plusSeconds(60));

        assertThat(observation.getReviewStatus()).isEqualTo("APPROVED");
        assertThat(observation.getReviewedContent()).isEqualTo("HR 核对后的稳定草稿");
    }

    @Test void storesAndClearsAnExplicitManualJobMatch(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getBossAccount()).thenReturn(mock(BossAccount.class));
        Instant now=Instant.parse("2026-08-30T12:00:00Z");UUID jobId=UUID.randomUUID();
        BrowserUnreadObservation observation=new BrowserUnreadObservation(device,DIGEST,now,now);

        observation.manuallyMatchJob(jobId,"nodejs开发工程师",now);

        assertThat(observation.getManualMatchJobPositionId()).isEqualTo(jobId);
        assertThat(observation.getManualMatchTitleKey()).isEqualTo("nodejs开发工程师");
        assertThat(observation.getManualMatchedAt()).isEqualTo(now);

        observation.clearManualJobMatch();

        assertThat(observation.getManualMatchJobPositionId()).isNull();
        assertThat(observation.getManualMatchTitleKey()).isNull();
        assertThat(observation.getManualMatchedAt()).isNull();
    }

    private UnreadObservationEntry entry(int unread,Instant at){return new UnreadObservationEntry(DIGEST,null,null,null,null,unread,at,at);}
}
