package ai.xzkj.recruitment.organization;

import java.time.Instant;
import java.util.UUID;

public record CompanyResponse(
        UUID id,
        String name,
        String code,
        CompanyStatus status,
        String location,
        String notes,
        String knowledgeIndustry,
        String knowledgeScale,
        String knowledgeSummary,
        boolean knowledgeApproved,
        int knowledgeVersion,
        Instant knowledgeApprovedAt,
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    static CompanyResponse from(Company company) {
        return new CompanyResponse(
                company.getId(), company.getName(), company.getCode(), company.getStatus(),
                company.getLocation(), company.getNotes(), company.getKnowledgeIndustry(), company.getKnowledgeScale(),
                company.getKnowledgeSummary(), company.isKnowledgeApproved(), company.getKnowledgeVersion(),
                company.getKnowledgeApprovedAt(), company.getVersion(),
                company.getCreatedAt(), company.getUpdatedAt()
        );
    }
}
