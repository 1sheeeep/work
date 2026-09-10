package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 匿名化的高频招聘沟通回归集，防止正常社交消息和明确岗位问题被混淆。 */
class InboundReplyQualityGateScenarioTest {
    @Test
    void evaluatesRepresentativeRecruitmentMessages() {
        List<Scenario> scenarios = List.of(
                valid("你好", "SOCIAL_GREETING", List.of(), "REPLY"),
                valid("谢谢你的回复", "SOCIAL_THANKS", List.of(), "REPLY"),
                valid("好的我知道了", "SOCIAL_ACKNOWLEDGEMENT", List.of(), "NO_REPLY"),
                valid("我考虑一下", "CANDIDATE_CONSIDERING", List.of(), "REPLY"),
                valid("晚点给你发简历", "RESUME_WILL_SEND", List.of(), "REPLY"),
                valid("简历已经发了", "RESUME_SENT", List.of(), "REPLY"),
                valid("暂时不考虑了", "CANDIDATE_DECLINE", List.of(), "REPLY"),
                valid("好的再见", "CONVERSATION_CLOSING", List.of(), "NO_REPLY"),
                valid("工作地点在哪里", "LOCATION", List.of(), "REPLY"),
                valid("工资多少钱", "SALARY", List.of(), "REPLY"),
                valid("没有经验可以吗", "EXPERIENCE", List.of(), "REPLY"),
                valid("学历有什么要求", "EDUCATION", List.of(), "REPLY"),
                valid("日常主要做什么", "RESPONSIBILITIES", List.of(), "REPLY"),
                valid("谢谢，薪资和工作地点呢", "SALARY", List.of("LOCATION", "SOCIAL_THANKS"), "REPLY"),
                invalid("谢谢，工资多少", "SOCIAL_THANKS", List.of(), "NO_REPLY"),
                invalid("你好，办公地点在哪", "SOCIAL_GREETING", List.of(), "REPLY"),
                invalid("本科能投吗", "SOCIAL_ACKNOWLEDGEMENT", List.of(), "NO_REPLY"),
                invalid("没经验也可以吗", "GENERAL_JOB_CONSULTATION", List.of(), "REPLY"),
                invalid("职责和薪资分别是什么", "RESPONSIBILITIES", List.of(), "REPLY"),
                invalid("感谢，工作地点和学历要求呢", "LOCATION", List.of("SOCIAL_THANKS"), "REPLY")
        );

        for (Scenario scenario : scenarios) {
            InboundJobReplyService.Topic topic = new InboundJobReplyService.Topic(
                    scenario.category(), scenario.secondary(), true, .95, scenario.action(), "LOW");
            String error = InboundReplyQualityGate.validateClassification(scenario.message(), topic);
            assertThat(error == null)
                    .as("message=%s category=%s secondary=%s error=%s",
                            scenario.message(), scenario.category(), scenario.secondary(), error)
                    .isEqualTo(scenario.valid());
        }
    }

    private static Scenario valid(String message, String category, List<String> secondary, String action) {
        return new Scenario(message, category, secondary, action, true);
    }

    private static Scenario invalid(String message, String category, List<String> secondary, String action) {
        return new Scenario(message, category, secondary, action, false);
    }

    private record Scenario(String message, String category, List<String> secondary, String action, boolean valid) { }
}
