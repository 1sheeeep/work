package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.organization.CompanyStatus;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public record HrUserResponse(
        UUID id,
        String username,
        String displayName,
        UserRole role,
        boolean enabled,
        List<CompanyScopeResponse> companies,
        Instant createdAt,
        Instant updatedAt
) {
    public static HrUserResponse from(SystemUser user) {
        List<CompanyScopeResponse> companies = user.getCompanyScopes().stream()
                .sorted(Comparator.comparing(company -> company.getName().toLowerCase()))
                .map(company -> new CompanyScopeResponse(
                        company.getId(), company.getName(), company.getCode(), company.getStatus()))
                .toList();
        return new HrUserResponse(user.getId(), user.getUsername(), user.getDisplayName(), user.getRole(),
                user.isEnabled(), companies, user.getCreatedAt(), user.getUpdatedAt());
    }

    public record CompanyScopeResponse(UUID id, String name, String code, CompanyStatus status) {
    }
}
