package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class InboundJobReplyServiceTest {
    @Test
    void detectsInterviewTimeCoordinationWithoutBlockingWorkHourQuestions() {
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("后天下午可以吗？", "HR：想约您来公司面试，时间我们再确认"));
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("那个时间安排在4点可以不？", ""));
        assertEquals(true, InboundJobReplyService.isInterviewCoordination("面试改到明天上午方便吗？", ""));
        assertEquals(false, InboundJobReplyService.isInterviewCoordination("请问这个岗位几点上下班？", "候选人：我想了解工作时间"));
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
    void allowsOnlyFactFreeLowRiskClarificationQuestions() {
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("OTHER_RECRUITMENT", List.of(), true, .91, "ASK_CLARIFICATION", "LOW")));
        assertNull(InboundJobReplyService.validateAgentPermission(
                new InboundJobReplyService.Topic("CLARIFICATION_REQUIRED", List.of(), true, .91, "ASK_CLARIFICATION", "LOW")));
        assertNull(InboundJobReplyService.validateClarification("请问您具体想了解这个岗位的哪一方面？", List.of()));
        assertEquals("澄清问题不得包含数字事实", InboundJobReplyService.validateClarification("请问您是想确认每天工作 8 小时吗？", List.of()));
        assertEquals("澄清问题不得引用岗位事实", InboundJobReplyService.validateClarification("请问您想了解哪方面？", List.of("DESCRIPTION")));
    }
}
