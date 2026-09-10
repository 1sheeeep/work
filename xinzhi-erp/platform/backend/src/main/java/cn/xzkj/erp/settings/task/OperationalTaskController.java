package cn.xzkj.erp.settings.task;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/settings/tasks")
public class OperationalTaskController {
    private final OperationalTaskService service;

    public OperationalTaskController(OperationalTaskService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageEnvelope<TaskResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "TITLE") @Size(max = 20) String searchBy,
            @RequestParam(required = false) @Size(max = 500) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) @Size(max = 20) String status,
            @RequestParam(required = false) @Size(max = 16) String urgency,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request),
                filters(searchBy, keyword, startDate, endDate, status, urgency),
                PageRequest.of(page, size)), TaskResponse::from);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('settings.read')")
    public TaskResponse detail(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, HttpServletRequest request) {
        return TaskResponse.from(service.detail(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('settings.task.write')")
    public TaskResponse create(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody TaskWriteRequest body,
            HttpServletRequest request) {
        return TaskResponse.from(service.create(actor(principal, request),
                body.input()));
    }

    @PostMapping("/{id}/status")
    @PreAuthorize("hasAuthority('settings.task.write')")
    public TaskResponse transition(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody StatusRequest body,
            HttpServletRequest request) {
        return TaskResponse.from(service.transition(actor(principal, request), id,
                body.version(), body.status()));
    }

    @PostMapping("/batch-complete")
    @PreAuthorize("hasAuthority('settings.task.write')")
    public List<TaskResponse> completeBatch(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchRequest body, HttpServletRequest request) {
        return service.completeBatch(actor(principal, request), body.tasks().stream()
                        .map(VersionItem::value).toList())
                .stream().map(TaskResponse::from).toList();
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('settings.read')")
    public ExportResponse export(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body, HttpServletRequest request) {
        var result = service.exportCsv(actor(principal, request), filters(
                body.searchBy(), body.keyword(), body.startDate(), body.endDate(),
                body.status(), body.urgency()));
        return new ExportResponse(result.filename(), result.mediaType(),
                result.rowCount(), result.content());
    }

    private static OperationalTaskService.Filters filters(String searchBy,
            String keyword, LocalDate startDate, LocalDate endDate,
            String status, String urgency) {
        return new OperationalTaskService.Filters(searchBy, keyword, startDate,
                endDate, status, urgency);
    }

    private static OperationalTaskService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new OperationalTaskService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record TaskWriteRequest(
            @NotBlank @Size(max = 160) String title,
            @NotBlank @Size(max = 80) String category,
            @NotBlank @Size(max = 160) String taskObject,
            @NotBlank @Size(max = 16) String urgency,
            @NotBlank @Size(max = 160) String assigneeName,
            @Size(max = 1000) String description) {
        OperationalTaskService.TaskInput input() {
            return new OperationalTaskService.TaskInput(title, category,
                    taskObject, urgency, assigneeName, description);
        }
    }

    public record StatusRequest(@Min(0) long version,
            @NotBlank @Size(max = 20) String status) {
    }

    public record VersionItem(@NotNull UUID id, @Min(0) long version) {
        OperationalTaskService.VersionedTask value() {
            return new OperationalTaskService.VersionedTask(id, version);
        }
    }

    public record BatchRequest(
            @NotEmpty @Size(max = 100) List<@Valid VersionItem> tasks) {
    }

    public record ExportRequest(
            @Size(max = 20) String searchBy,
            @Size(max = 500) String keyword,
            LocalDate startDate,
            LocalDate endDate,
            @Size(max = 20) String status,
            @Size(max = 16) String urgency) {
    }

    public record TaskResponse(UUID id, String taskNo, String title,
            String category, String taskObject, String urgency,
            String assigneeName, String description, String status,
            Instant completedAt, String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static TaskResponse from(OperationalTaskRecord value) {
            return new TaskResponse(value.id(), value.taskNo(), value.title(),
                    value.category(), value.taskObject(), value.urgency(),
                    value.assigneeName(), value.description(), value.status(),
                    value.completedAt(), value.createdByDisplayName(),
                    value.version(), value.createdAt(), value.updatedAt());
        }
    }

    public record ExportResponse(String filename, String mediaType, int rowCount,
            String content) {
    }
}
