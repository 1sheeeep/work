package ai.xzkj.recruitment.tasks;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/recruitment-tasks")
public class RecruitmentTaskController {
    private final RecruitmentTaskService service;

    public RecruitmentTaskController(RecruitmentTaskService service) { this.service = service; }

    @GetMapping
    public List<RecruitmentTaskResponse> list(@RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) UUID companyId,
                                              @RequestParam(required = false) RecruitmentTaskStatus status) {
        return service.list(keyword, companyId, status);
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public RecruitmentTaskResponse create(@Valid @RequestBody RecruitmentTaskUpsertRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public RecruitmentTaskResponse update(@PathVariable UUID id,
                                           @Valid @RequestBody RecruitmentTaskUpsertRequest request) {
        return service.update(id, request);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public RecruitmentTaskResponse changeStatus(@PathVariable UUID id,
                                                 @Valid @RequestBody RecruitmentTaskStatusRequest request) {
        return service.changeStatus(id, request.status());
    }

    @PostMapping("/{id}/run")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public TaskRunResponse run(@PathVariable UUID id,
                               @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.run(id, idempotencyKey);
    }

    @PostMapping("/{id}/retry")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public TaskRunResponse retry(@PathVariable UUID id,
                                 @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.retry(id, idempotencyKey);
    }

    @GetMapping("/{id}/executions")
    public List<TaskExecutionResponse> listExecutions(@PathVariable UUID id) {
        return service.listExecutions(id);
    }
}
