package ai.xzkj.recruitment.ai;

import ai.xzkj.recruitment.candidates.ScreeningOutcome;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MockAiGatewayTest {
    private final MockAiGateway gateway = new MockAiGateway();

    @Test void parsesDeterministicJobFields() {
        var result = gateway.parseJob("Java 后端工程师\n工作地点：上海\n薪资 20K-35K·14薪\n要求 3-5 年，本科");
        assertThat(result.title()).isEqualTo("Java 后端工程师");
        assertThat(result.location()).isEqualTo("上海");
        assertThat(result.salaryMinK()).isEqualTo(20);
        assertThat(result.salaryMaxK()).isEqualTo(35);
        assertThat(result.salaryMonths()).isEqualTo(14);
        assertThat(result.experienceRequirement()).isEqualTo("3-5 年");
        assertThat(result.educationRequirement()).isEqualTo("本科");
    }

    @Test void keepsIncompleteCandidateForHumanReview() {
        var candidate = new AiGateway.CandidateFacts("Java 开发", null, "本科", "");
        var job = new AiGateway.JobFacts("Java 后端", "3-5 年", "本科", "Java", "后端开发");
        assertThat(gateway.screenCandidate(candidate, job).outcome()).isEqualTo(ScreeningOutcome.REVIEW);
    }
}
