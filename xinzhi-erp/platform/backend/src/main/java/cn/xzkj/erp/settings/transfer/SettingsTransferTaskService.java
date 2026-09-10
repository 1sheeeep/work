package cn.xzkj.erp.settings.transfer;

import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettingsTransferTaskService {
    private static final List<String> STATUSES = List.of(
            "ALL", "PENDING", "RUNNING", "SUCCEEDED", "PARTIALLY_FAILED",
            "FAILED", "CANCELLED");
    private final SettingsTransferTaskRepository repository;

    public SettingsTransferTaskService(SettingsTransferTaskRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<SettingsTransferTaskRecord> list(UUID tenantId, Filters filters,
            Pageable pageable) {
        requireTenant(tenantId);
        return repository.list(tenantId, normalize(filters), pageable);
    }

    @Transactional(readOnly = true)
    public Artifact result(UUID tenantId, UUID taskId) {
        requireTenant(tenantId);
        if (taskId == null) {
            throw new IllegalArgumentException("Transfer task identifier is required");
        }
        Artifact result = repository.findArtifact(tenantId, taskId);
        if (result == null) {
            throw new ResourceNotFoundException("Transfer task result not found");
        }
        return result;
    }

    private static Filters normalize(Filters filters) {
        Filters value = filters == null
                ? new Filters("ALL", "ALL", null, null, null, null)
                : filters;
        String jobType = value.jobType() == null || value.jobType().isBlank()
                ? "ALL" : value.jobType().strip().toUpperCase();
        String status = value.status() == null || value.status().isBlank()
                ? "ALL" : value.status().strip().toUpperCase();
        if (!List.of("ALL", "IMPORT", "EXPORT").contains(jobType)) {
            throw new IllegalArgumentException("Transfer task type is invalid");
        }
        if (!STATUSES.contains(status)) {
            throw new IllegalArgumentException("Transfer task status is invalid");
        }
        String keyword = value.keyword() == null
                ? null : value.keyword().strip();
        if (keyword != null && (keyword.isEmpty() || keyword.length() > 160
                || keyword.chars().anyMatch(character -> character < 32
                        || character == 127))) {
            throw new IllegalArgumentException(
                    "Transfer task keyword is invalid");
        }
        if (value.startDate() != null && value.endDate() != null) {
            long days = ChronoUnit.DAYS.between(
                    value.startDate(), value.endDate());
            if (days < 0 || days > 366) {
                throw new IllegalArgumentException(
                        "Transfer task date range is invalid");
            }
        }
        return new Filters(jobType, status, keyword, value.resultAvailable(),
                value.startDate(), value.endDate());
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new AccessDeniedException("A tenant is required");
        }
    }

    public record Filters(String jobType, String status, String keyword,
            Boolean resultAvailable,
            LocalDate startDate, LocalDate endDate) {
    }

    public record Artifact(String filename, String mediaType, byte[] content) {
        public Artifact {
            content = content == null ? null : content.clone();
        }

        @Override
        public byte[] content() {
            return content == null ? null : content.clone();
        }
    }
}
