package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.organization.CompanyStatus;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public record BossAccountResponse(
        UUID id,
        CompanySummary company,
        String displayName,
        String externalIdentifier,
        BossGatewayType gatewayType,
        BossAccountStatus status,
        BossConnectionStatus connectionStatus,
        List<BossCapability> capabilities,
        Instant lastCheckedAt,
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    public static BossAccountResponse from(BossAccount account) {
        var company = account.getCompany();
        return new BossAccountResponse(
                account.getId(), new CompanySummary(company.getId(), company.getName(), company.getCode(), company.getStatus()),
                account.getDisplayName(), account.getExternalIdentifier(), account.getGatewayType(),
                account.getStatus(), account.getConnectionStatus(), account.getCapabilities().stream()
                .sorted(Comparator.comparing(Enum::name)).toList(), account.getLastCheckedAt(), account.getVersion(),
                account.getCreatedAt(), account.getUpdatedAt());
    }

    public record CompanySummary(UUID id, String name, String code, CompanyStatus status) {
    }
}
