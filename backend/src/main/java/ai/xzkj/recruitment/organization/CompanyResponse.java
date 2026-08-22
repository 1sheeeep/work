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
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    static CompanyResponse from(Company company) {
        return new CompanyResponse(
                company.getId(), company.getName(), company.getCode(), company.getStatus(),
                company.getLocation(), company.getNotes(), company.getVersion(),
                company.getCreatedAt(), company.getUpdatedAt()
        );
    }
}
