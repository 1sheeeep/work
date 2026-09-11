package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.organization.Company;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class JobPositionVisibleCaptureTest {
    private final Instant observedAt = Instant.parse("2026-08-30T08:00:00Z");

    @Test void upgradesAnUnverifiedImportedDraftWithVisibleFields() {
        JobPosition job = importedDraft();
        boolean changed = job.applyVisiblePageObservation("a".repeat(64), "Java 开发工程师", "上海·徐汇",
                20, 30, 13, "3-5年", "本科", "负责后端系统开发", "20-30K·13薪",
                "社会全职", "后端开发", "境内岗位", "Java｜Spring", "上海市徐汇区", 11, observedAt);
        assertThat(changed).isTrue();
        assertThat(job.getCaptureSource()).isEqualTo("VISIBLE_PAGE");
        assertThat(job.getLocation()).isEqualTo("上海·徐汇");
        assertThat(job.getSalaryMinK()).isEqualTo(20);
        assertThat(job.getObservedSourceKey()).isEqualTo("c".repeat(64));
        assertThat(job.getRecruitmentType()).isEqualTo("社会全职");
        assertThat(job.getJobCategory()).isEqualTo("后端开发");
        assertThat(job.getWorkAddress()).isEqualTo("上海市徐汇区");
        assertThat(job.isCaptureVerified()).isFalse();
    }

    @Test void marksAVisibleManualDraftWithoutOverwritingHumanData() {
        JobPosition job = new JobPosition(mock(Company.class), mock(BossAccount.class), "Java 开发工程师", "北京",
                40, 50, 14, "5年以上", "本科", "人工审核内容", null);
        boolean changed = job.applyVisiblePageObservation("b".repeat(64), "错误标题", "错误地点",
                1, 2, 12, "不限", "不限", "错误描述", "1-2K",
                "错误类型", "错误类别", "错误驻外", "错误关键词", "错误地址", 11, observedAt);
        assertThat(changed).isTrue();
        assertThat(job.getTitle()).isEqualTo("Java 开发工程师");
        assertThat(job.getLocation()).isEqualTo("北京");
        assertThat(job.getSalaryMinK()).isEqualTo(40);
        assertThat(job.getCaptureSource()).isEqualTo("VISIBLE_PAGE");
        assertThat(job.getObservedSourceKey()).isEqualTo("b".repeat(64));
    }

    @Test void closesOnlyAfterTwoConsecutiveCompleteOpenSnapshotsMissTheJob() {
        JobPosition job = importedDraft();
        job.applyVisiblePageObservation("c".repeat(64), "Java 开发工程师", "上海", 20, 30, 13,
                "3-5年", "本科", "后端开发", "20-30K·13薪", null, null, null, null, null, 6, observedAt);
        job.changeStatus(JobPositionStatus.ACTIVE);

        assertThat(job.markMissingFromCompleteOpenSnapshot()).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.ACTIVE);
        assertThat(job.markMissingFromCompleteOpenSnapshot()).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.CLOSED);
    }

    @Test void followsAnExplicitBossClosedOrReopenedStatus() {
        JobPosition job = importedDraft();
        job.applyVisiblePageObservation("c".repeat(64), "Java 开发工程师", "上海", 20, 30, 13,
                "3-5年", "本科", "后端开发", "20-30K·13薪", null, null, null, null, null, 6, observedAt);
        job.changeStatus(JobPositionStatus.ACTIVE);

        assertThat(job.reconcilePlatformStatus("CLOSED")).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.CLOSED);
        assertThat(job.reconcilePlatformStatus("OPEN")).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.DRAFT);
        assertThat(job.isCaptureVerified()).isFalse();
    }

    @Test void movesAnActiveJobBackToDraftWhenBossFieldsChange() {
        JobPosition job = importedDraft();
        job.applyVisiblePageObservation("c".repeat(64), "Java 开发工程师", "上海", 20, 30, 13,
                "3-5年", "本科", "后端开发", "20-30K·13薪", null, null, null, null, null, 6, observedAt);
        job.changeStatus(JobPositionStatus.ACTIVE);

        assertThat(job.applyVisiblePageObservation("c".repeat(64), "高级 Java 开发工程师", "上海", 25, 35, 13,
                "5年以上", "本科", "后端开发", "25-35K·13薪", null, null, null, null, null, 6, observedAt.plusSeconds(30))).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.DRAFT);
        assertThat(job.getTitle()).isEqualTo("高级 Java 开发工程师");
        assertThat(job.isCaptureVerified()).isFalse();
    }

    @Test void routineObservationDoesNotOverwriteOrInvalidateReviewedJob() {
        JobPosition job = importedDraft();
        job.applyVisiblePageObservation("c".repeat(64), "Java 开发工程师", "上海", 20, 30, 13,
                "3-5年", "本科", "后端开发", "20-30K·13薪", null, null, null, null, null, 6, observedAt);
        job.updateKnowledge("稳定岗位回复知识", "20-30K·13薪", true);
        job.changeStatus(JobPositionStatus.ACTIVE);

        boolean changed = job.recordVisiblePageObservation("c".repeat(64), observedAt.plusSeconds(60));

        assertThat(changed).isFalse();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.ACTIVE);
        assertThat(job.isKnowledgeApproved()).isTrue();
        assertThat(job.getTitle()).isEqualTo("Java 开发工程师");
        assertThat(job.getLocation()).isEqualTo("上海");
    }

    @Test void routineReopenPreservesApprovedJobWithoutForcingReview() {
        JobPosition job = importedDraft();
        job.updateKnowledge("稳定岗位回复知识", "20-30K·13薪", true);
        job.changeStatus(JobPositionStatus.ACTIVE);
        job.reconcilePlatformStatus("CLOSED");

        assertThat(job.reconcilePlatformStatus("OPEN", false)).isTrue();
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.ACTIVE);
        assertThat(job.isKnowledgeApproved()).isTrue();
    }

    @Test void explicitRecaptureCanReplaceAPreviouslyManualProfile() {
        JobPosition job = new JobPosition(mock(Company.class), mock(BossAccount.class), "旧标题", "旧地点",
                10, 20, 12, "不限", "本科", "旧描述", null);

        assertThat(job.applyVisiblePageObservation("d".repeat(64), "新标题", "上海", 20, 30, 13,
                "3-5年", "本科", "新描述", "20-30K·13薪", null, null, null, null, null, 6,
                observedAt, true)).isTrue();
        assertThat(job.getTitle()).isEqualTo("新标题");
        assertThat(job.getLocation()).isEqualTo("上海");
        assertThat(job.getDescription()).isEqualTo("新描述");
    }

    private JobPosition importedDraft() {
        JobPosition job = new JobPosition(mock(Company.class), mock(BossAccount.class), "Java 开发工程师", "待从 BOSS 岗位页补全",
                1, 1, 12, "待从 BOSS 岗位页补全", "待从 BOSS 岗位页补全", "待补全", null);
        job.markUnreadObservation("c".repeat(64), true);
        return job;
    }
}
