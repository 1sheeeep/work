package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.boss.BossAccountStatus;
import ai.xzkj.recruitment.boss.BossConnectionStatus;
import ai.xzkj.recruitment.organization.CompanyStatus;

import java.time.Instant;
import java.util.UUID;

public record JobPositionResponse(
        UUID id,
        CompanySummary company,
        BossAccountSummary bossAccount,
        String title,
        String location,
        int salaryMinK,
        int salaryMaxK,
        int salaryMonths,
        String experienceRequirement,
        String educationRequirement,
        String description,
        String screeningRequirements,
        JobPositionStatus status,
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    public static JobPositionResponse from(JobPosition job) {
        var company = job.getCompany();
        var account = job.getBossAccount();
        return new JobPositionResponse(
                job.getId(),
                new CompanySummary(company.getId(), company.getName(), company.getCode(), company.getStatus()),
                new BossAccountSummary(account.getId(), account.getDisplayName(), account.getExternalIdentifier(),
                        account.getStatus(), account.getConnectionStatus()),
                job.getTitle(), job.getLocation(), job.getSalaryMinK(), job.getSalaryMaxK(), job.getSalaryMonths(),
                job.getExperienceRequirement(), job.getEducationRequirement(), job.getDescription(),
                job.getScreeningRequirements(), job.getStatus(), job.getVersion(), job.getCreatedAt(), job.getUpdatedAt());
    }

    public record CompanySummary(UUID id, String name, String code, CompanyStatus status) {
    }

    public record BossAccountSummary(UUID id, String displayName, String externalIdentifier,
                                     BossAccountStatus status, BossConnectionStatus connectionStatus) {
    }
}
