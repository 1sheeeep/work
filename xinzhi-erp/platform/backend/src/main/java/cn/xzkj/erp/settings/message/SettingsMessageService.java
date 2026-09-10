package cn.xzkj.erp.settings.message;

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
public class SettingsMessageService {
    private final SettingsMessageRepository repository;

    public SettingsMessageService(SettingsMessageRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<SettingsMessageRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor, normalize(filters), pageable);
    }

    @Transactional
    public int markRead(Actor actor, List<UUID> noticeIds) {
        requireActor(actor);
        if (noticeIds == null || noticeIds.isEmpty() || noticeIds.size() > 100
                || noticeIds.stream().anyMatch(value -> value == null)
                || noticeIds.stream().distinct().count() != noticeIds.size()) {
            throw new IllegalArgumentException("Message identifiers are invalid");
        }
        return repository.markRead(actor, noticeIds);
    }

    private static Filters normalize(Filters filters) {
        Filters value = filters == null
                ? new Filters(null, null, null, null) : filters;
        String type = normalizeValue(value.type(), "ALL");
        String readState = normalizeValue(value.readState(), "ALL");
        if (!List.of("ALL", "INTERNAL_NOTICE").contains(type)) {
            throw new IllegalArgumentException("Message type is invalid");
        }
        if (!List.of("ALL", "UNREAD", "READ").contains(readState)) {
            throw new IllegalArgumentException("Message read state is invalid");
        }
        if (value.startDate() != null && value.endDate() != null) {
            long days = ChronoUnit.DAYS.between(value.startDate(), value.endDate());
            if (days < 0 || days > 366) {
                throw new IllegalArgumentException("Message date range is invalid");
            }
        }
        return new Filters(value.startDate(), value.endDate(), type, readState);
    }

    private static String normalizeValue(String value, String fallback) {
        return value == null || value.isBlank()
                ? fallback : value.strip().toUpperCase();
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId) {
        String actorType() {
            return userId == null ? "SYSTEM_ADMIN" : "USER";
        }

        UUID actorId() {
            return userId == null ? systemAdminId : userId;
        }
    }

    public record Filters(LocalDate startDate, LocalDate endDate,
            String type, String readState) {
    }
}
