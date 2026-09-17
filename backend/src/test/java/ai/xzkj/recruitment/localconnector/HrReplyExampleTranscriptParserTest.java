package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class HrReplyExampleTranscriptParserTest {
    @Test
    void parsesClipboardTranscriptAndGroupsConsecutiveCandidateTurns() {
        HrReplyExampleTranscriptParser.ParsedTranscript result = HrReplyExampleTranscriptParser.parse("""
                BOSS 当前会话记录（已脱敏）
                岗位：跨境客服主管
                [10:01] 候选人：你好，请问工作地点在哪里？
                [10:02] 候选人：薪资是多少？
                [10:03] HR：您好，地点和薪资以招聘页面展示为准。
                [10:04] 候选人：好的，谢谢。
                [10:05] HR：不客气。
                """);

        assertThat(result.jobTitle()).isEqualTo("跨境客服主管");
        assertThat(result.pairs()).hasSize(2);
        assertThat(result.pairs().getFirst().candidateMessage()).contains("工作地点").contains("薪资");
        assertThat(result.pairs().getFirst().hrReply()).isEqualTo("您好，地点和薪资以招聘页面展示为准。");
    }

    @Test
    void redactsCommonContactDataBeforePersistence() {
        String value = HrReplyExampleTranscriptParser.redact("电话 13812345678，邮箱 hr@example.com，微信 wx:example_123", 500);

        assertThat(value).doesNotContain("13812345678").doesNotContain("hr@example.com").doesNotContain("example_123");
        assertThat(value).contains("[手机号已脱敏]").contains("[邮箱已脱敏]").contains("[微信号已脱敏]");
    }

    @Test
    void categorizesFactualQuestionBeforeCourtesyWords() {
        assertThat(HrReplyExampleService.classifyIntent("谢谢，请问工资多少？")).isEqualTo("SALARY");
    }

    @Test
    void recognizesEquivalentCurrentFactsForReusableReferences() {
        assertThat(HrReplyExampleService.hasReusableApprovedFact("薪资范围是 8 至 13K，具体可以再沟通。", Map.of("SALARY", "8-13K"))).isTrue();
        assertThat(HrReplyExampleService.hasReusableApprovedFact("工作地点在深圳南山区。", Map.of("LOCATION", "深圳南山区"))).isTrue();
    }

    @Test
    void doesNotTreatStaleFactsAsReusable() {
        assertThat(HrReplyExampleService.hasReusableApprovedFact("薪资范围是 6-8K。", Map.of("SALARY", "8-13K"))).isFalse();
    }

    @Test
    void ranksEquivalentCandidatePhrasesAsStrongLearningMatches() {
        assertThat(HrReplyExampleService.similarity("您好，请问岗位平常都是怎么推进呀？", "岗位平常都是怎么推进呀"))
                .isGreaterThanOrEqualTo(0.78);
        assertThat(HrReplyExampleService.similarity("请问有宿舍吗", "这个岗位的薪资是多少"))
                .isLessThan(0.78);
        assertThat(HrReplyExampleService.classifyIntent("请问月休是大小周吗")).isEqualTo("WORK_TIME");
        assertThat(HrReplyExampleService.classifyIntent("公司提供宿舍吗")).isEqualTo("BENEFITS");
    }
}
