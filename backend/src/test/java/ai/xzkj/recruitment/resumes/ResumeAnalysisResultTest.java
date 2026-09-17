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

    @Test
    void normalizesCompatibleEvidenceStatusAliases() {
        String response = """
                {
                  "recommendation":"NORMAL_VIEW",
                  "summary":"简历与岗位存在部分匹配项。",
                  "evidence":[
                    {"criterion":"工作地点","finding":"简历未明确工作地点。","status":"MISS"},
                    {"criterion":"项目经验","finding":"简历列出相关项目。","status":"MATCHED"},
                    {"criterion":"学历要求","finding":"简历信息不足以判断。","status":"UNKNOWN"}
                  ],
                  "gaps":[],
                  "risks":[],
                  "followUpQuestions":["请说明最近项目职责？","请说明期望工作地点？","何时可以到岗？"]
                }
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.evidence()).extracting(ResumeAnalysisEvidence::status)
                .containsExactly("NOT_FOUND", "FOUND", "UNCLEAR");
    }

    @Test
    void acceptsStringifiedNestedAnalysisAndRepairsMissingOptionalFields() {
        String response = """
                {"result":{"analysis":{"recommendation":"UNKNOWN_PROVIDER_VALUE","summary":"","evidence":[],"gaps":["a","b","c","d","e","f","g","h","ignored"],"risks":[],"followUpQuestions":[]}}}
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.recommendation()).isEqualTo("INFORMATION_NEEDED");
        assertThat(result.summary()).contains("待确认项");
        assertThat(result.evidence()).singleElement().extracting(ResumeAnalysisEvidence::status).isEqualTo("UNCLEAR");
        assertThat(result.gaps()).hasSize(8);
        assertThat(result.followUpQuestions()).hasSize(3);
    }

    @Test
    void derivesOverallSummaryFromJobComparisonWhenProviderOmitsTopLevelSummary() {
        String response = """
                {
                  "recommendation":"INFORMATION_NEEDED",
                  "evidence":[{"criterion":"岗位：运营助理","finding":"简历有数据整理经验。","status":"FOUND"}],
                  "gaps":["缺少独立站运营经验"],
                  "risks":[],
                  "followUpQuestions":["请说明最近职责？","请说明项目成果？","何时到岗？"],
                  "jobComparisons":[{"jobId":"job-1","jobTitle":"运营助理","summary":"经历集中在数据整理，未发现独立站运营事实。","responsibilities":[{"responsibility":"负责店铺运营","resumeEvidence":"未在简历中找到明确证据","status":"NOT_FOUND"}],"skillMatches":[],"gaps":[],"risks":[]}]
                }
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.summary()).isEqualTo("根据已返回的岗位职责与简历证据，运营助理：经历集中在数据整理，未发现独立站运营事实。");
        assertThat(result.summary()).doesNotContain("大模型未返回明确摘要");
    }

    @Test
    void upgradesPreviouslyStoredFallbackSummaryWhenComparisonSummaryExists() {
        String stored = """
                {"candidateName":"候选人","recommendation":"INFORMATION_NEEDED","summary":"大模型未返回明确摘要，请结合岗位要求和简历原文由 HR 复核。","evidence":[{"criterion":"岗位","finding":"待确认","status":"UNCLEAR"}],"gaps":[],"risks":[],"followUpQuestions":["问题一","问题二","问题三"],"jobComparisons":[{"jobId":"job-1","jobTitle":"客服","summary":"有客户沟通经验。","responsibilities":[{"responsibility":"沟通客户","resumeEvidence":"简历有相关经历","status":"FOUND"}],"skillMatches":[],"gaps":[],"risks":[]}]}
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseStored(stored, mapper);

        assertThat(result.summary()).isEqualTo("根据已返回的岗位职责与简历证据，客服：有客户沟通经验。");
    }

    @Test
    void preservesValidJobComparisonsWhenAnotherComparisonIsMalformed() {
        String response = """
                {"recommendation":"NORMAL_VIEW","summary":"总体对比完成。","evidence":[{"criterion":"岗位：开发","finding":"有 Java 经验。","status":"FOUND"}],"gaps":[],"risks":[],"followUpQuestions":["请说明职责？","请说明成果？","何时到岗？"],"jobComparisons":["错误项",{"jobId":"job-1","jobTitle":"Java 开发","summary":"经验相关。","responsibilities":[{"responsibility":"接口开发","resumeEvidence":"简历写明 Java 项目。","status":"MATCHED"},"错误职责"],"skillMatches":[{"skill":"Java","requirement":"熟悉 Java","resumeEvidence":"列出 Java","status":"FOUND"}],"gaps":[],"risks":[]}]}
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.jobComparisons()).singleElement().satisfies(comparison -> {
            assertThat(comparison.jobTitle()).isEqualTo("Java 开发");
            assertThat(comparison.responsibilities()).singleElement()
                    .extracting(ResumeResponsibilityMatch::status).isEqualTo("FOUND");
        });
    }

    @Test
    void repairsWrongOptionalFieldTypesInsteadOfRejectingTheWholeAnalysis() {
        String response = """
                {"recommendation":12,"summary":null,"evidence":"wrong-type","gaps":"wrong-type","risks":null,"followUpQuestions":"wrong-type","jobComparisons":{"wrong":true}}
                """;

        ResumeAnalysisResult result = ResumeAnalysisResult.parseExternal(response, mapper);

        assertThat(result.recommendation()).isEqualTo("INFORMATION_NEEDED");
        assertThat(result.evidence()).isNotEmpty();
        assertThat(result.followUpQuestions()).hasSize(3);
        assertThat(result.jobComparisons()).isEmpty();
    }
}
