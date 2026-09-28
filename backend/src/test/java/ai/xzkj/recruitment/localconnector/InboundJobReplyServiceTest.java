package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobReplyTemplateService;
import ai.xzkj.recruitment.resumes.OpenAiProperties;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InboundJobReplyServiceTest {
    @Test
    void retainsRecentContextAndTreatsRepeatedQuestionsAsPending() {
        String context = "HR：" + "历史内容".repeat(700) + "\n候选人：工资是多少\nHR：工资4000\n候选人：工资的构成呢";
        String recent = InboundJobReplyService.cleanContext(context);
        assertTrue(recent.length() <= 2400);
        assertTrue(recent.endsWith("候选人：工资的构成呢"));
        assertTrue(InboundJobReplyService.summarizeConversation(recent).pendingCandidateTopics().contains("SALARY"));
    }

    @Test
    void doesNotHideQuestionsBehindResumeTemplatesOrBypassInterviewHandoff() {
        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        InboundJobReplyService service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        assertEquals(false, service.decide(job, "简历已经发了，工资是多少？").replyAllowed());
        assertEquals(false, service.decide(job, "可以发简历吗，工资是多少？").replyAllowed());
        var handoff = service.decide(job, "您好", "",
                new InboundJobReplyService.ConversationRuntime("INTERVIEW_SCHEDULED", true, false, false, true));
        assertEquals(false, handoff.replyAllowed());
        assertEquals("INTERVIEW_COORDINATION", handoff.category());
    }
    @Test
    void detectsDeterministicHiringAndResumeLeadMessages() {
        assertTrue(InboundJobReplyService.isHiringStatusInquiry("请问还招人吗"));
        assertTrue(InboundJobReplyService.isResumePermissionOrJobInterest("可否给您发送简历，进一步沟通呢？"));
        assertTrue(InboundJobReplyService.isResumePermissionOrJobInterest("我想应聘贵公司的AI应用开发助理，盼望回复，谢谢！"));
        assertTrue(InboundJobReplyService.isResumePermissionOrJobInterest("小白可以吗，很感兴趣，并且会认真学习"));
        assertTrue(InboundJobReplyService.isResumePermissionOrJobInterest("看到这个岗位接受新人，请考虑下我谢谢"));
        assertTrue(InboundJobReplyService.isResumePermissionOrJobInterest("感觉自己很合适，希望可以有面试机会"));
        assertEquals(false, InboundJobReplyService.isResumePermissionOrJobInterest("暂时不考虑这个岗位"));
        assertTrue(InboundJobReplyService.isResumePermissionQuestion(
                "Boss您好，我对这个岗位很感兴趣，之前有过一些相关实习经历，也认真看了岗位介绍，请问我这边可以先发一份简历吗？"));
        assertTrue(InboundJobReplyService.isResumePermissionQuestion("请问可以发分简历吗"));
        assertEquals(false, InboundJobReplyService.isResumePermissionQuestion("我暂时不方便发简历"));
    }

    @Test
    void detectsPureGreetingAndDetailedFactQuestions() {
        assertTrue(InboundJobReplyService.isPureGreeting("你好；"));
        assertTrue(InboundJobReplyService.isPureGreeting("您好！"));
        assertTrue(InboundJobReplyService.isPureAcknowledgement("好的！"));
        assertTrue(InboundJobReplyService.isPureAcknowledgement("可以"));
        assertTrue(InboundJobReplyService.isPureAcknowledgement("好嘿"));
        assertTrue(InboundJobReplyService.isPureAcknowledgement("了解了"));
        assertTrue(InboundJobReplyService.isPureAcknowledgement("OK"));
        assertEquals(false, InboundJobReplyService.isPureAcknowledgement("好的，请问薪资多少"));
        assertEquals(false, InboundJobReplyService.isPureAcknowledgement("你好"));
        assertTrue(InboundJobReplyService.isDetailedJobQuestion(
                "您好，大专应届生，有国内电商运营助理实习。薪资无责4k是底薪吗？是否缴纳五险一金，是双休还是大小周？"));
        assertEquals(false, InboundJobReplyService.isDetailedJobQuestion("请问这个岗位薪资是多少？"));
    }

    @Test
    void detectsDeterministicFallbackQuestionsThatMustNotDependOnAi() {
        assertTrue(InboundJobReplyService.isWorkTimeQuestion("上班时间到晚上吗"));
        assertTrue(InboundJobReplyService.isRestDaysQuestion("月休几天"));
        assertTrue(InboundJobReplyService.isPaydayQuestion("发薪日是几号"));
        assertTrue(InboundJobReplyService.isCandidateDecline("办公地点较远，不在考虑范围内"));
        assertTrue(InboundJobReplyService.isNoExperienceQuestion("我之前没有做过，你这边可以接受吗"));
        assertTrue(InboundJobReplyService.isNoExperienceQuestion("小白可以吗"));
        assertTrue(InboundJobReplyService.isInterviewCancellation("不好意思，明天的面试我先取消了"));
        assertTrue(InboundJobReplyService.isInterviewCancellation("非常抱歉，因临时有事，无法按照定时间参加面试。"));
        assertEquals(false, InboundJobReplyService.isInterviewCancellation("不好意思，刚看到您的消息"));
        assertEquals(false, InboundJobReplyService.isInterviewCancellation("能安排面试吗"));
        assertTrue(InboundJobReplyService.isInterviewResultInquiry("请问面试结果什么时候出来", ""));
        assertTrue(InboundJobReplyService.isInterviewResultInquiry("有结果了吗", "HR：昨天已经完成面试"));
        assertEquals(false, InboundJobReplyService.isInterviewResultInquiry("什么时候方便过去面试", ""));
        assertTrue(InboundJobReplyService.isDetailedResponsibilityQuestion("可以详细介绍一下这个岗位的工作内容和每天的工作流程吗？"));
    }

    @Test
    void noExperienceAndInterviewCancellationUseSafeRepliesWithoutCallingTheModel() {
        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        when(job.getReplySummary()).thenReturn("话术补充：可接受无相关经验，入职后有人带教。");
        InboundJobReplyService service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());

        InboundJobReplyService.Decision noExperience = service.decide(job, "我之前没有做过，你这边是可以接受的吗");
        assertTrue(noExperience.replyAllowed());
        assertEquals("JOB_INTEREST", noExperience.category());
        assertTrue(noExperience.content().contains("简历"));

        InboundJobReplyService.Decision cancellation = service.decide(job, "不好意思，明天的面试我先取消了");
        assertTrue(cancellation.replyAllowed());
        assertEquals("CANDIDATE_DECLINE", cancellation.category());
        assertEquals("感谢投递，祝您求职顺利。", cancellation.content());

        InboundJobReplyService.Decision cannotAttend = service.decide(job, "非常抱歉，因临时有事，无法按照定时间参加面试。");
        assertTrue(cannotAttend.replyAllowed());
        assertEquals("CANDIDATE_DECLINE", cannotAttend.category());
        assertEquals("感谢投递，祝您求职顺利。", cannotAttend.content());
    }

    @Test
    void usesDeterministicRepliesForCourtesyMealsAndPostResumeMessages() {
        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        InboundJobReplyService service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());

        InboundJobReplyService.Decision meals = service.decide(job, "请问有宿舍吗");
        assertTrue(meals.replyAllowed());
        assertEquals("MEALS_LODGING", meals.category());
        assertEquals("吃住自理", meals.content());

        InboundJobReplyService.Decision acknowledgement = service.decide(job, "可以");
        assertTrue(acknowledgement.replyAllowed());
        assertEquals("好的", acknowledgement.content());

        InboundJobReplyService.Decision ok = service.decide(job, "OK");
        assertTrue(ok.replyAllowed());
        assertEquals("好的", ok.content());

        InboundJobReplyService.Decision greeting = service.decide(job, "你好");
        assertTrue(greeting.replyAllowed());
        assertEquals("您好", greeting.content());

        InboundJobReplyService.Decision interviewInterest = service.decide(
                job, "您好，感觉自己很合适，希望可以有面试机会～");
        assertTrue(interviewInterest.replyAllowed());
        assertEquals("JOB_INTEREST", interviewInterest.category());
        assertEquals("可以的，您把简历发过来就行，我先了解一下。", interviewInterest.content());

        InboundJobReplyService.Decision longResumePermission = service.decide(job,
                "Boss您好，我是26届毕业生，看到职位介绍后很感兴趣，也有相关项目经历，如果这边还在招聘，我可以先发一份简历吗？");
        assertTrue(longResumePermission.replyAllowed());
        assertEquals("RESUME_WILL_SEND", longResumePermission.category());
        assertEquals("可以", longResumePermission.content());

        InboundJobReplyService.Decision portfolio = service.decide(job,
                "这个是我的作品，您可以看看：https://example.test/portfolio");
        assertTrue(portfolio.replyAllowed());
        assertEquals("收到，我这边会看一下您的作品，后续再和您联系。", portfolio.content());

        InboundJobReplyService.Decision benefits = service.decide(job, "入职购买社保吗");
        assertTrue(benefits.replyAllowed());
        assertEquals("社保情况面试时会详细说明。", benefits.content());

        when(job.getBenefits()).thenReturn("五险一金、节日福利");
        InboundJobReplyService benefitsWithFacts = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        InboundJobReplyService.Decision benefitsFromJob = benefitsWithFacts.decide(job, "福利待遇怎么样");
        assertTrue(benefitsFromJob.replyAllowed());
        assertEquals("BENEFITS", benefitsFromJob.category());
        assertTrue(benefitsFromJob.content().contains("五险一金、节日福利"));

        InboundJobReplyService.Decision benefitsFollowUp = benefitsWithFacts.decide(job, "那具体呢",
                "候选人：福利待遇有哪些");
        assertTrue(benefitsFollowUp.replyAllowed());
        assertEquals("BENEFITS", benefitsFollowUp.category());
        assertTrue(benefitsFollowUp.content().contains("五险一金、节日福利"));

        InboundJobReplyService.Decision afterResume = service.decide(job, "请问有宿舍吗", "",
                new InboundJobReplyService.ConversationRuntime("RESUME_RECEIVED", true, false, false, false));
        assertTrue(afterResume.replyAllowed());
        assertEquals("MEALS_LODGING", afterResume.category());
        assertEquals("吃住自理", afterResume.content());

        InboundJobReplyService.Decision resumeThenWorkTime = service.decide(job,
                "我已经发过简历了，请问几点上班？", "候选人：之前已发送简历",
                new InboundJobReplyService.ConversationRuntime("RESUME_RECEIVED", true, false, false, false));
        assertTrue(resumeThenWorkTime.replyAllowed());
        assertEquals("WORK_TIME", resumeThenWorkTime.category());
        assertEquals("工作方面的具体情况，面试的时候会详细解答。", resumeThenWorkTime.content());
        assertEquals(false, InboundJobReplyService.isPureResumeSentStatement("我已经发过简历了，请问岗位还招吗？"));
        assertTrue(InboundJobReplyService.isPureResumeSentStatement("我已经把简历发过去了"));

        InboundJobReplyService.Decision interestAfterResume = service.decide(job, "我对这个岗位很感兴趣", "",
                new InboundJobReplyService.ConversationRuntime("RESUME_RECEIVED", true, false, false, false));
        assertTrue(interestAfterResume.replyAllowed());
        assertEquals("JOB_INTEREST", interestAfterResume.category());
        assertEquals("可以继续沟通，您想了解岗位哪方面的信息呢？", interestAfterResume.content());

        InboundJobReplyService.Decision resumeResult = service.decide(job, "请问面试通过了吗", "");
        assertEquals(false, resumeResult.replyAllowed());
        assertEquals("INTERVIEW_RESULT", resumeResult.category());

        InboundJobReplyService.Decision shortResumeConfirmation = service.decide(job, "发了",
                "HR：方便的话发一份简历过来\n候选人：发了");
        assertTrue(shortResumeConfirmation.replyAllowed());
        assertEquals("RESUME_SENT", shortResumeConfirmation.category());
        assertEquals("好的，我先看一下您的简历，了解后再和您联系。", shortResumeConfirmation.content());
    }

    @Test
    void usesTrialPeriodTemplateOnlyWhenTheJobProvidesApprovedFactData() {
        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        JobReplyTemplateService templates = mock(JobReplyTemplateService.class);
        when(templates.renderFixedFact(job, "工作这边有试岗期吗", "")).thenReturn(Optional.of(
                new JobReplyTemplateService.RenderedReply(
                        "TRIAL_PERIOD", "岗位试岗安排为3天，具体细节面试时再详细沟通。", "岗位资料")));
        InboundJobReplyService service = new InboundJobReplyService(
                new OpenAiProperties(), new ObjectMapper(), null, templates);

        InboundJobReplyService.Decision result = service.decide(job, "工作这边有试岗期吗");

        assertEquals(true, result.replyAllowed());
        assertEquals("TRIAL_PERIOD", result.category());
        assertEquals("岗位试岗安排为3天，具体细节面试时再详细沟通。", result.content());
    }

    @Test
    void classifiesResumeContextWithoutReopeningHistoricalAttachments() {
        JobPosition job = mock(JobPosition.class);
        InboundJobReplyService service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        String digest = "a".repeat(64);
        Instant now = Instant.now();
        var request = new ResumeAttachmentContextCheckRequest(
                digest, digest, "INBOUND", now, "简历附件", "HR：简历已收到", ConversationSignals.none(), digest, now);

        var historical = service.classifyResumeAttachment(job, request, true);
        assertEquals("HISTORICAL_RESUME", historical.classification());
        assertEquals(1.0, historical.confidence());

        var unavailable = service.classifyResumeAttachment(job, request, false);
        assertEquals("UNCERTAIN", unavailable.classification());
        assertEquals(0.0, unavailable.confidence());
    }

    @Test
    void reusesAHighSimilarityRealHrReplyInsteadOfSkippingTheConversation() {
        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        HrReplyExampleService examples = mock(HrReplyExampleService.class);
        when(examples.findStrongSimilarReply(job, "岗位平常都是怎么推进呀"))
                .thenReturn(Optional.of(new HrReplyExampleService.LearnedReply(
                        "GENERAL_JOB_CONSULTATION", "岗位平常都是怎么推进呀",
                        "工作方面的具体情况，面试的时候会详细解答。", 1.0)));
        InboundJobReplyService service = new InboundJobReplyService(
                new OpenAiProperties(), new ObjectMapper(), examples, null);

        InboundJobReplyService.Decision result = service.decide(job, "岗位平常都是怎么推进呀");

        assertTrue(result.replyAllowed());
        assertEquals("工作方面的具体情况，面试的时候会详细解答。", result.content());
        assertTrue(result.reason().contains("真实 HR 话术"));
    }

    @Test
    void roleConfirmationMustMatchTheCurrentJobBeforeUsingFixedReply() {
        var job = mock(ai.xzkj.recruitment.jobs.JobPosition.class);
        when(job.getTitle()).thenReturn("跨境电商运营助理");
        when(job.getJobCategory()).thenReturn("电商运营");
        when(job.getDescription()).thenReturn("负责店铺运营和数据整理");
        assertTrue(InboundJobReplyService.isRoleConfirmationQuestion(job, "是运营是吗？"));
        when(job.getTitle()).thenReturn("人事前台");
        when(job.getJobCategory()).thenReturn("行政");
        when(job.getDescription()).thenReturn("负责前台接待");
        assertEquals(false, InboundJobReplyService.isRoleConfirmationQuestion(job, "是运营是吗？"));
    }

    @Test
    void detectsInterviewTimeCoordinationWithoutBlockingWorkHourQuestions() {
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("你好，什么时候方便过去面试呢？", ""));
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("后天下午可以吗？", "HR：想约您来公司面试，时间我们再确认"));
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("那个时间安排在4点可以不？", ""));
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("面试改到明天上午方便吗？", ""));
        assertEquals(false, InboundJobReplyService.isInterviewCoordination("请问这个岗位几点上下班？", "候选人：我想了解工作时间"));
        assertEquals(false, InboundJobReplyService.isInterviewCoordination("感觉自己很合适，希望可以有面试机会", ""));
    }

    @Test
    void silentlyClosesConfirmedInterviewAcceptanceButKeepsSchedulingQuestionsForHr() {
        assertTrue(InboundJobReplyService.isInterviewAcceptance("可以参加面试", ""));
        assertTrue(InboundJobReplyService.isInterviewAcceptance("确认参加面试", ""));
        assertTrue(InboundJobReplyService.isInterviewAcceptance("可以", "HR：明天来面试可以吗？"));
        assertEquals(false, InboundJobReplyService.isInterviewAcceptance("可以安排面试吗", ""));
        assertEquals(false, InboundJobReplyService.isInterviewAcceptance("面试什么时候安排", ""));

        JobPosition job = mock(JobPosition.class);
        when(job.isKnowledgeApproved()).thenReturn(true);
        InboundJobReplyService service = new InboundJobReplyService(new OpenAiProperties(), new ObjectMapper());
        InboundJobReplyService.Decision result = service.decide(job, "可以",
                "HR：明天来面试可以吗？");

        assertEquals(false, result.replyAllowed());
        assertEquals("INTERVIEW_ACCEPTED", result.category());
        assertTrue(result.reason().startsWith("正常静默："));
    }

    @Test
    void acceptsGroundedConciseSummary() {
        Map<String, String> facts = Map.of("DESCRIPTION", "负责客户咨询、订单跟进及售后问题处理");
        assertNull(InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，主要负责客户咨询、订单跟进及售后问题处理。", List.of("DESCRIPTION"), facts));
    }

    @Test
    void rejectsInventedNumbersAndBenefits() {
        Map<String, String> facts = Map.of("DESCRIPTION", "负责客户咨询与售后处理");
        assertEquals("回复包含岗位资料中不存在的数字", InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，每月薪资 8000 元。", List.of("DESCRIPTION"), facts));
        assertEquals("回复新增了未经审核的福利或待遇", InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，该岗位双休。", List.of("DESCRIPTION"), facts));
        assertEquals("回复新增了未经审核的福利或待遇", InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，岗位支持远程办公。", List.of("DESCRIPTION"), facts));
        assertEquals("回复新增了未经审核的福利或待遇", InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，岗位提供餐补。", List.of("DESCRIPTION"), facts));
    }

    @Test
    void rejectsEvidenceOutsideApprovedFacts() {
        assertEquals("模型引用了当前问答场景无权访问的岗位字段", InboundJobReplyService.validateGeneratedReply("RESPONSIBILITIES", "您好，主要负责团队管理。", List.of("SALARY"), Map.of("DESCRIPTION", "负责客户咨询")));
    }

    @Test
    void exactFieldQuestionsMustPreserveApprovedValue() {
        Map<String, String> facts = Map.of("SALARY", "8-13K");
        assertNull(InboundJobReplyService.validateGeneratedReply("SALARY", "您好，招聘页面标注薪资为 8-13K。", List.of("SALARY"), facts));
        assertEquals("精确字段未按已审核原文回答", InboundJobReplyService.validateGeneratedReply("SALARY", "您好，薪资可沟通。", List.of("SALARY"), facts));
    }

    @Test
    void jobInterestCanNaturallyContinueTheBoundConversationWithoutRepeatingLongTitle() {
        Map<String, String> facts = Map.of(
                "JOB_TITLE", "跨境客服主管+月休6天+五险+无责底薪",
                "NEXT_STEP", "候选人可发送简历；后续安排以招聘人员确认为准");
        assertNull(InboundJobReplyService.validateGeneratedReply(
                "JOB_INTEREST",
                "您好，可以聊聊。您方便的话可以先发一份简历，我这边结合岗位要求进一步了解。",
                List.of("NEXT_STEP"),
                facts));
    }

    @Test
    void supportsMultipleQuestionIntentsWithFieldLevelPermissions() {
        Map<String, String> facts = Map.of("LOCATION", "东莞南城", "EXPERIENCE", "经验不限");
        assertNull(InboundJobReplyService.validateGeneratedReply(
                List.of("LOCATION", "EXPERIENCE"), "工作地点在东莞南城，经验要求为经验不限。",
                List.of("LOCATION", "EXPERIENCE"), facts));
    }

    @Test
    void backendPermissionMatrixRejectsRiskAndUnauthorizedActions() {
        assertEquals("AI 判断该消息需要人工复核，未自动回复", InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("SALARY", List.of(), true, .96, "REPLY", "MEDIUM")));
        assertEquals("索要简历动作与当前问答意图不匹配，已阻止执行", InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("LOCATION", List.of(), true, .96, "REQUEST_RESUME", "LOW")));
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("JOB_INTEREST", List.of("LOCATION"), true, .96, "REQUEST_RESUME", "LOW")));
    }

    @Test
    void summarizesRecentTurnsWithoutPersistingTheirMessageBodies() {
        InboundJobReplyService.ConversationMemory memory = InboundJobReplyService.summarizeConversation("""
                候选人：工作地点在哪里？
                候选人：这个岗位主要做什么？
                HR：主要负责客户咨询。
                候选人：可以聊聊吗？
                """);

        assertEquals(4, memory.turns());
        assertEquals(1, memory.consecutiveCandidateTurns());
        assertEquals(List.of("LOCATION", "JOB_INTEREST"), memory.pendingCandidateTopics());
        assertEquals(List.of("RESPONSIBILITIES"), memory.recentlyAnsweredTopics());
    }

    @Test
    void derivesConversationSignalsWithoutRetainingMessageBodies() {
        InboundJobReplyService.ConversationMemory memory = InboundJobReplyService.summarizeConversation("""
                HR：您好，方便的话可以发一份简历。
                候选人：好的，简历已经发了。
                HR：收到，有问题可以随时联系。
                候选人：谢谢。
                """);

        assertEquals("CANDIDATE", memory.lastSpeaker());
        assertEquals(true, memory.hrAlreadyGreeted());
        assertEquals(true, memory.lastHrWasClosing());
        assertEquals(true, memory.resumeRequestedByHr());
        assertEquals(true, memory.resumeSentByCandidate());
        assertEquals(2, memory.trailingSocialTurns());
    }

    @Test
    void allowsOnlyFactFreeLowRiskClarificationQuestions() {
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("OTHER_RECRUITMENT", List.of(), true, .91, "ASK_CLARIFICATION", "LOW")));
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("CLARIFICATION_REQUIRED", List.of(), true, .91, "ASK_CLARIFICATION", "LOW")));
        assertNull(InboundJobReplyService.validateClarification("请问您具体想了解这个岗位的哪一方面？", List.of()));
        assertEquals("澄清问题不得包含数字事实", InboundJobReplyService.validateClarification("请问您是想确认每天工作 8 小时吗？", List.of()));
        assertEquals("澄清问题不得引用岗位事实", InboundJobReplyService.validateClarification("请问您想了解哪方面？", List.of("DESCRIPTION")));
    }

    @Test
    void socialRepliesAreFactFreeButStillStrictlyValidated() {
        assertNull(InboundJobReplyService.validateSocialReply("不客气，有其他想了解的可以随时告诉我。", List.of()));
        assertEquals("社交回复不得引用岗位事实",
                InboundJobReplyService.validateSocialReply("不客气。", List.of("HIRING_STATUS")));
        assertEquals("社交回复包含需要岗位资料支持的事实",
                InboundJobReplyService.validateSocialReply("不客气，这个岗位目前还在招聘中。", List.of()));
        assertEquals("社交回复不得包含未经核验的数字",
                InboundJobReplyService.validateSocialReply("好的，2 天内联系您。", List.of()));
    }

    @Test
    void permissionMatrixSeparatesSocialAndGroundedReplyModes() {
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("SOCIAL_THANKS", List.of(), true, .75, "REPLY", "LOW")));
        assertEquals("社交回复模式与当前意图或动作不匹配，已阻止执行",
                InboundJobReplyService.validateAgentPermission(
                        new InboundJobReplyService.Topic("SOCIAL_THANKS", List.of(), true, .75, "REQUEST_RESUME", "LOW")));
    }

    @Test
    void courtesyAcknowledgementsUseUniversalAck() {
        assertTrue(InboundJobReplyService.isCourtesyIntent("SOCIAL_ACKNOWLEDGEMENT"));
        assertEquals("好的", InboundJobReplyService.courtesyReply());
        assertTrue(InboundJobReplyService.isCourtesyIntent("CONVERSATION_CLOSING"));
        assertTrue(!InboundJobReplyService.isCourtesyIntent("CANDIDATE_CONSIDERING"));
    }

    @Test
    void actionableCandidateMessagesCannotBeSilencedByLeadingGreeting() {
        List<String> messages = List.of(
                "Boss您好，我是26年毕业生，可以和您进一步沟通AI应用开发助理这个职位吗？",
                "您好，可以聊聊吗？您这个职位我很有兴趣，希望进一步了解",
                "Boss您好，我对您发布的职位非常感兴趣，可以把简历发给您吗？",
                "你好，非常喜欢这个岗位，一定能够努力胜任，期待您的回复");

        for (String message : messages) {
            assertTrue(InboundJobReplyService.hasActionableRecruitmentSignal(message), message);
            InboundJobReplyService.Topic reinforced = InboundJobReplyService.reinforceActionableTopic(
                    message, new InboundJobReplyService.Topic(
                            "SOCIAL_GREETING", List.of(), true, .95, "NO_REPLY", "LOW"));
            assertEquals("REPLY", reinforced.action(), message);
            assertTrue(reinforced.relevant(), message);
            assertNull(InboundJobReplyService.expectedSilenceReason(
                    reinforced,
                    InboundJobReplyService.ConversationMemory.empty(),
                    message), message);
        }
    }

    @Test
    void pureCourtesyStillHasNoActionableRecruitmentSignal() {
        assertTrue(!InboundJobReplyService.hasActionableRecruitmentSignal("好的，谢谢您"));
        assertTrue(InboundJobReplyService.isCourtesyIntent("SOCIAL_ACKNOWLEDGEMENT"));
    }

    @Test
    void preventsRequestingAResumeThatWasRequestedOrReceivedAlready() {
        InboundJobReplyService.Topic request = new InboundJobReplyService.Topic(
                "JOB_INTEREST", List.of(), true, .96, "REQUEST_RESUME", "LOW");
        InboundJobReplyService.ConversationMemory requested = InboundJobReplyService.summarizeConversation(
                "HR：方便的话可以发一份简历。");
        assertEquals("最近对话中 HR 已经索要简历，已阻止重复索要",
                InboundJobReplyService.validateConversationAction(
                        request, "您可以发一份简历。", requested, InboundJobReplyService.ConversationRuntime.empty()));

        InboundJobReplyService.ConversationRuntime received = new InboundJobReplyService.ConversationRuntime(
                "RESUME_RECEIVED", true, false, false, false);
        assertEquals("可信会话状态显示简历已经收到，已阻止重复索要",
                InboundJobReplyService.validateConversationAction(
                        request, "您可以发一份简历。", InboundJobReplyService.ConversationMemory.empty(), received));
    }

    @Test
    void independentGateRejectsAJobQuestionMisclassifiedAsPureCourtesy() {
        InboundJobReplyService.Topic wrong = new InboundJobReplyService.Topic(
                "SOCIAL_THANKS", List.of(), true, .93, "NO_REPLY", "LOW");

        assertEquals("最后一条消息包含明确岗位问题，但 AI 未覆盖意图：SALARY",
                InboundReplyQualityGate.validateClassification("谢谢，请问工资多少？", wrong));
    }

    @Test
    void independentGateAcceptsMixedCourtesyWhenTheJobIntentIsCovered() {
        InboundJobReplyService.Topic mixed = new InboundJobReplyService.Topic(
                "SALARY", List.of("SOCIAL_THANKS"), true, .95, "REPLY", "LOW");

        assertNull(InboundReplyQualityGate.validateClassification("谢谢，请问工资多少？", mixed));
    }

    @Test
    void independentGateRejectsModelMetaLanguageAndExcessivePunctuation() {
        assertEquals("回复包含模型元信息或明显模板化话术",
                InboundReplyQualityGate.validateReply("根据提供的信息，这个岗位目前在招聘。"));
        assertEquals("回复包含连续重复标点",
                InboundReplyQualityGate.validateReply("好的！！！"));
        assertNull(InboundReplyQualityGate.validateReply("好的，简历收到后我们会继续查看。"));
    }
}
