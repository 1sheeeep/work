package cn.xzkj.erp.settings.approval;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ApprovalRuleRecord(
        UUID id,
        int priority,
        String name,
        ApprovalRuleService.DocumentType documentType,
        String description,
        boolean enabled,
        List<Approver> approvers,
        long version,
        String createdByDisplayName,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {
    public ApprovalRuleRecord {
        approvers = List.copyOf(approvers);
    }

    public record Approver(UUID userId, String displayName, int stepOrder) {
    }
}
