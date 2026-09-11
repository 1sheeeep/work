package ai.xzkj.recruitment.resumes;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

class ResumeAnalysisResultTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsJsonWrappedInMarkdownFenceFromCompatibleProvider() {
        String response = """
                ```json
                {
                  "recommendation":"NORMAL_VIEW",
                  "summary":"岗位经历基本匹配，建议 HR 进一步核对。",
                  "evidence":[{"criterion":"Node.js","finding":"简历列出三年 Node.js 开发经验。","status":"FOUND"}],
                  "gaps":[],
                  "risks":[],
                  "followUpQuestions":["请说明最近项目职责？","请说明生产环境规模？","何时可以到岗？"]
                }
                ```
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.recommendation()).isEqualTo("NORMAL_VIEW");
        assertThat(result.followUpQuestions()).hasSize(3);
    }

    @Test
    void removesPunctuationOnlyListItemsFromCompatibleProvider() {
        String response = """
                {
                  "recommendation":"PRIORITY_VIEW",
                  "summary":"经历与岗位基本匹配。",
                  "evidence":[{"criterion":"相关经验","finding":"有两年相关经历。","status":"FOUND"}],
                  "gaps":[],
                  "risks":[],
                  "followUpQuestions":[",","请说明主要职责？","请说明项目成果？","何时可以到岗？"]
                }
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.followUpQuestions()).containsExactly("请说明主要职责？", "请说明项目成果？", "何时可以到岗？");
    }

    @Test
    void normalizesCompatibleRecommendationAliases() {
        String response = """
                {
                  "recommendation":"INTERVIEW_RECOMMENDED",
                  "summary":"经历与岗位基本匹配。",
                  "evidence":[{"criterion":"相关经验","finding":"有相关经历。","status":"FOUND"}],
                  "gaps":[],
                  "risks":[],
                  "followUpQuestions":["请说明主要职责？","请说明项目成果？","何时可以到岗？"]
                }
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.recommendation()).isEqualTo("PRIORITY_VIEW");
    }
}
