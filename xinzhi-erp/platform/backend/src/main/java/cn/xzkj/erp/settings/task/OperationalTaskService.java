package cn.xzkj.erp.settings.task;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OperationalTaskService {
    static final int MAX_EXPORT_ROWS = 10_000;
    private static final String CSV_MEDIA_TYPE = "text/csv;charset=utf-8";
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final Set<String> SEARCH_FIELDS = Set.of(
            "TITLE", "ASSIGNEE", "OBJECT", "TASK_NO");
    private static final Set<String> STATUSES = Set.of(
            "PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "DELETED");
    private static final Set<String> URGENCIES = Set.of("NORMAL", "URGENT");
    private static final List<String> CSV_HEADER = List.of(
            "任务编号", "任务标题", "分类", "任务对象", "紧急程度", "创建人",
            "执行人", "创建时间", "完成时间", "状态");
    private final OperationalTaskRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public OperationalTaskService(OperationalTaskRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<OperationalTaskRecord> list(Actor actor, Filters filters,
            Pageable pageable) {
        requireActor(actor);
        return repository.list(actor.tenantId(), normalize(filters), pageable);
    }

    @Transactional(readOnly = true)
    public OperationalTaskRecord detail(Actor actor, UUID id) {
        requireActor(actor);
        return requireTask(actor.tenantId(), id);
    }

    @Transactional
    public OperationalTaskRecord create(Actor actor, TaskInput input) {
        requireActor(actor);
        TaskInput normalized = normalize(input);
        UUID id = UUID.randomUUID();
        String taskNo = "TASK-" + LocalDate.now(BUSINESS_ZONE).toString()
                .replace("-", "") + "-"
                + id.toString().replace("-", "").substring(0, 6)
                        .toUpperCase(Locale.ROOT);
        repository.insert(id, actor.tenantId(), taskNo, normalized, actor);
        audit(actor, "settings.task.created", id, Map.of(
                "category", normalized.category(),
                "urgency", normalized.urgency()));
        return requireTask(actor.tenantId(), id);
    }

    @Transactional
    public OperationalTaskRecord transition(Actor actor, UUID id, long version,
            String targetStatus) {
        requireActor(actor);
        OperationalTaskRecord current = requireTask(actor.tenantId(), id);
        String target = enumValue(targetStatus, STATUSES, "Task status is invalid");
        validateTransition(current.status(), target);
        if (version < 0 || !repository.transition(actor.tenantId(), id, version,
                current.status(), target, actor)) {
            throw new ConflictException("Task changed concurrently");
        }
        audit(actor, "settings.task.status_changed", id, Map.of(
                "fromStatus", current.status(), "toStatus", target));
        return requireTask(actor.tenantId(), id);
    }

    @Transactional
    public List<OperationalTaskRecord> completeBatch(Actor actor,
            List<VersionedTask> tasks) {
        requireActor(actor);
        if (tasks == null || tasks.isEmpty() || tasks.size() > 100
                || tasks.stream().anyMatch(value -> value == null
                || value.id() == null || value.version() < 0)
                || tasks.stream().map(VersionedTask::id).distinct().count()
                != tasks.size()) {
            throw new IllegalArgumentException("Tasks to complete are invalid");
        }
        return tasks.stream()
                .map(task -> transition(actor, task.id(), task.version(),
                        "COMPLETED"))
                .toList();
    }

    @Transactional(readOnly = true)
    public TaskExport exportCsv(Actor actor, Filters filters) {
        requireActor(actor);
        List<OperationalTaskRecord> records = repository.export(actor.tenantId(),
                normalize(filters), MAX_EXPORT_ROWS + 1);
        if (records.size() > MAX_EXPORT_ROWS) {
            throw new ConflictException("Task export exceeds the supported row limit");
        }
        return new TaskExport("operational-tasks.csv", CSV_MEDIA_TYPE,
                records.size(), csv(records));
    }

    private OperationalTaskRecord requireTask(UUID tenantId, UUID id) {
        if (id == null) throw new ResourceNotFoundException("Task was not found");
        OperationalTaskRecord value = repository.find(tenantId, id);
        if (value == null) throw new ResourceNotFoundException("Task was not found");
        return value;
    }

    private void audit(Actor actor, String action, UUID id,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                "operational_task", id.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static NormalizedFilters normalize(Filters filters) {
        Filters value = filters == null
                ? new Filters(null, null, null, null, null, null) : filters;
        String searchBy = value.searchBy() == null ? "TITLE"
                : enumValue(value.searchBy(), SEARCH_FIELDS,
                        "Task search field is invalid");
        String status = optionalEnum(value.status(), STATUSES,
                "Task status is invalid");
        String urgency = optionalEnum(value.urgency(), URGENCIES,
                "Task urgency is invalid");
        if (value.startDate() != null && value.endDate() != null
                && value.endDate().isBefore(value.startDate())) {
            throw new IllegalArgumentException("Task date range is invalid");
        }
        return new NormalizedFilters(searchBy, optional(value.keyword(), 500),
                start(value.startDate()), endExclusive(value.endDate()),
                status, urgency);
    }

    private static TaskInput normalize(TaskInput input) {
        if (input == null) throw new IllegalArgumentException("Task is required");
        return new TaskInput(
                required(input.title(), 160, "Task title is invalid"),
                required(input.category(), 80, "Task category is invalid"),
                required(input.taskObject(), 160, "Task object is invalid"),
                enumValue(input.urgency(), URGENCIES,
                        "Task urgency is invalid"),
                required(input.assigneeName(), 160,
                        "Task assignee is invalid"),
                optional(input.description(), 1000));
    }

    private static void validateTransition(String from, String target) {
        boolean allowed = switch (from) {
            case "PENDING" -> Set.of("IN_PROGRESS", "COMPLETED", "DELETED")
                    .contains(target);
            case "IN_PROGRESS" -> Set.of("COMPLETED", "FAILED", "DELETED")
                    .contains(target);
            case "FAILED" -> Set.of("IN_PROGRESS", "COMPLETED", "DELETED")
                    .contains(target);
            case "COMPLETED" -> "DELETED".equals(target);
            case "DELETED" -> "PENDING".equals(target);
            default -> false;
        };
        if (!allowed) throw new ConflictException("Task status transition is invalid");
    }

    private static Instant start(LocalDate value) {
        return value == null ? null : value.atStartOfDay(BUSINESS_ZONE).toInstant();
    }

    private static Instant endExclusive(LocalDate value) {
        return value == null ? null
                : value.plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant();
    }

    private static String enumValue(String value, Set<String> allowed,
            String message) {
        String normalized = value == null ? ""
                : value.strip().toUpperCase(Locale.ROOT);
        if (!allowed.contains(normalized)) throw new IllegalArgumentException(message);
        return normalized;
    }

    private static String optionalEnum(String value, Set<String> allowed,
            String message) {
        return value == null || value.isBlank()
                ? null : enumValue(value, allowed, message);
    }

    private static String required(String value, int maximum, String message) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum
                || normalized.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static String optional(String value, int maximum) {
        return value == null || value.isBlank()
                ? null : required(value, maximum, "Task text is invalid");
    }

    private static String csv(List<OperationalTaskRecord> records) {
        StringBuilder output = new StringBuilder("\uFEFF");
        appendCsvRow(output, CSV_HEADER);
        for (OperationalTaskRecord task : records) {
            appendCsvRow(output, List.of(task.taskNo(), task.title(),
                    task.category(), task.taskObject(), task.urgency(),
                    task.createdByDisplayName(), task.assigneeName(),
                    task.createdAt().toString(),
                    task.completedAt() == null ? "" : task.completedAt().toString(),
                    task.status()));
        }
        return output.toString();
    }

    private static void appendCsvRow(StringBuilder output, List<String> cells) {
        output.append(cells.stream().map(OperationalTaskService::csvCell)
                .reduce((left, right) -> left + "," + right).orElse(""))
                .append("\r\n");
    }

    private static String csvCell(String value) {
        String safe = value == null ? "" : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    private static void requireActor(Actor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null
                || !actor.requestId().matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new AccessDeniedException("A tenant actor is required");
        }
        required(actor.displayName(), 160, "Actor display name is invalid");
    }

    public record Actor(UUID tenantId, UUID userId, UUID systemAdminId,
            String displayName, String requestId, String sourceIp) {
    }

    public record TaskInput(String title, String category, String taskObject,
            String urgency, String assigneeName, String description) {
    }

    public record Filters(String searchBy, String keyword, LocalDate startDate,
            LocalDate endDate, String status, String urgency) {
    }

    record NormalizedFilters(String searchBy, String keyword,
            Instant createdFrom, Instant createdToExclusive,
            String status, String urgency) {
    }

    public record VersionedTask(UUID id, long version) {
    }

    public record TaskExport(String filename, String mediaType, int rowCount,
            String content) {
    }
}
