package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.MockBossProfile;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SafeReplyComposerTest {
    @Test
    void matchesOnlyDisplayEquivalentJobTitles() {
        JobPosition job = job("Node.js 全栈开发工程师");

        assertThat(SafeReplyComposer.matchActiveJob("Ｎｏｄｅ．ｊｓ　全栈开发工程师", List.of(job)))
                .contains(job);
        assertThat(SafeReplyComposer.matchActiveJob("Node.js 后端开发工程师", List.of(job)))
                .isEmpty();
    }

    @Test
    void refusesAmbiguousNormalizedTitles() {
        assertThat(SafeReplyComposer.matchActiveJob("Java开发", List.of(job("Java 开发"), job("Java-开发"))))
                .isEmpty();
    }

    @Test
    void composesVersionedKnowledgeReplyAndFallsBackWithoutApproval() {
        JobPosition job = job("Java 开发工程师");
        assertThat(SafeReplyComposer.compose(job).mode()).isEqualTo("GENERIC");

        Company company = job.getCompany();
        company.updateKnowledge("企业软件服务", "100-499人", "专注于企业数字化产品", true);
        job.updateKnowledge("负责稳定的后端服务开发", "20-35K·13薪", true);
        SafeReplyComposer.Composition result = SafeReplyComposer.compose(job);

        assertThat(result.mode()).isEqualTo("KNOWLEDGE");
        assertThat(result.content()).contains("Java 开发工程师", "企业软件服务", "20-35K·13薪");
        assertThat(result.reason()).contains("公司知识 v1", "岗位知识 v1");
    }

    @Test
    void requiresHumanVerificationForVisiblePageCapturedJobs() {
        JobPosition job = job("Java 开发工程师");
        Company company = job.getCompany();
        company.updateKnowledge("企业软件服务", "100-499人", "专注于企业数字化产品", true);
        job.updateKnowledge("负责稳定的后端服务开发", "20-35K·13薪", true);
        job.markVisiblePageCapture(6);

        assertThat(SafeReplyComposer.compose(job).mode()).isEqualTo("GENERIC");
        assertThat(SafeReplyComposer.compose(job).missingFields()).contains("页面采集资料待核对");

        job.verifyVisiblePageCapture();
        assertThat(SafeReplyComposer.compose(job).mode()).isEqualTo("KNOWLEDGE");
    }

    private JobPosition job(String title) {
        GroupProfile group = new GroupProfile("新知科技集团", "新知");
        Company company = new Company(group, "新知科技集团", "XINZHI_GROUP", "上海", null);
        BossAccount account = new BossAccount(company, "BOSS 主招聘账号", "boss-main-01", MockBossProfile.FULL);
        return new JobPosition(company, account, title, "上海", 20, 35, 13,
                "3-5 年", "本科", "负责后端系统开发", null);
    }
}
