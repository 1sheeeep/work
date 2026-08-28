package ai.xzkj.recruitment.interviews;

import ai.xzkj.recruitment.notifications.NotificationRetryResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController @RequestMapping("/api/interviews")
public class InterviewController {
    private final InterviewService service;public InterviewController(InterviewService service){this.service=service;}
    @GetMapping public List<InterviewScheduleResponse> list(@RequestParam(required=false)String keyword,@RequestParam(required=false)UUID companyId,@RequestParam(required=false)InterviewStatus status){return service.list(keyword,companyId,status);}
    @GetMapping("/{id}") public InterviewDetailResponse detail(@PathVariable UUID id){return service.detail(id);}
    @PostMapping public InterviewScheduleResponse create(@Valid @RequestBody InterviewCreateRequest request){return service.create(request);}
    @PostMapping("/{id}/confirm/{slotId}") public InterviewConfirmationResponse confirm(@PathVariable UUID id,@PathVariable UUID slotId,@RequestHeader("Idempotency-Key")String key){return service.confirm(id,slotId,key);}
    @PostMapping("/{id}/reschedule") public InterviewScheduleResponse reschedule(@PathVariable UUID id,@Valid @RequestBody InterviewSlotsRequest request){return service.reschedule(id,request);}
    @PatchMapping("/{id}/notification-outcome") public InterviewScheduleResponse updateMock(@PathVariable UUID id,@Valid @RequestBody NotificationOutcomeRequest request){return service.updateMockOutcome(id,request);}
    @PostMapping("/{id}/notifications/{notificationId}/retry") public NotificationRetryResponse retry(@PathVariable UUID id,@PathVariable UUID notificationId,@RequestHeader("Idempotency-Key")String key){return service.retryNotification(id,notificationId,key);}
    @PostMapping("/{id}/cancel") public InterviewScheduleResponse cancel(@PathVariable UUID id){return service.cancel(id);}
}
