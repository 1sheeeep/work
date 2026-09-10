package ai.xzkj.recruitment.localconnector;
import jakarta.validation.Valid;import org.springframework.http.HttpHeaders;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.web.bind.annotation.*;import java.util.*;
@RestController public class LocalConnectorController{
 private final LocalConnectorService service;public LocalConnectorController(LocalConnectorService s){service=s;}
 @GetMapping("/api/local-connector/devices")public List<DeviceResponse> list(){return service.list();}
 @PostMapping("/api/local-connector/devices/pairings")public PairingResponse create(@Valid@RequestBody CreatePairingRequest r){return service.createPairing(r.accountId());}
 @DeleteMapping("/api/local-connector/devices/{id}")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public void revoke(@PathVariable UUID id){service.revoke(id);}
 @PostMapping("/api/local-connector/runtime/pair")public DeviceCredentialsResponse pair(@Valid@RequestBody PairDeviceRequest r){return service.pair(r);}
 @PostMapping("/api/local-connector/runtime/heartbeat")public DeviceResponse heartbeat(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody HeartbeatRequest r){return service.heartbeat(token,r);}
 @GetMapping("/api/local-connector/runtime/duty-automation")public DutyAutomationControlResponse dutyAutomation(@RequestHeader(HttpHeaders.AUTHORIZATION)String token){return service.dutyAutomation(token);}
 @PostMapping("/api/local-connector/runtime/unread-observations")public UnreadObservationSyncResponse observations(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody UnreadObservationSnapshot r){return service.observeUnread(token,r);}
 @PostMapping("/api/local-connector/runtime/job-observations")public VisibleJobSyncResponse jobs(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody VisibleJobSnapshot r){return service.observeVisibleJobs(token,r);}
 @PostMapping("/api/local-connector/runtime/selected-conversation")public UnreadObservationResponse selected(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody SelectedConversationSnapshot r){return service.verifySelectedConversation(token,r);}
 @PostMapping("/api/local-connector/runtime/inbound-reply-decision")public InboundReplyDecisionResponse inboundReplyDecision(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody InboundReplyDecisionRequest r){return service.decideInboundReply(token,r);}
 @PostMapping("/api/local-connector/runtime/inbound-reply-tasks")public InboundReplyTaskAcceptedResponse submitInboundReply(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody InboundReplyDecisionRequest r){return service.submitInboundReply(token,r);}
 @GetMapping("/api/local-connector/runtime/inbound-reply-tasks/{id}")public InboundReplyTaskStatusResponse inboundReplyTaskStatus(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@PathVariable UUID id){return service.inboundReplyTaskStatus(token,id);}
 @PostMapping("/api/local-connector/runtime/inbound-reply-tasks/{id}/discard")public InboundReplyTaskDiscardResponse discardStaleInboundReply(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@PathVariable UUID id,@Valid@RequestBody InboundReplyTaskDiscardRequest r){return service.discardStaleInboundReply(token,id,r);}
 @PostMapping("/api/local-connector/runtime/inbound-reply-send/claim")public InboundReplySendClaimResponse claimInboundReplySend(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody InboundReplySendClaimRequest r){return service.claimInboundReplySend(token,r);}
 @PostMapping("/api/local-connector/runtime/inbound-reply-send/receipt")public InboundReplySendReceiptResponse receiptInboundReplySend(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody InboundReplySendReceiptRequest r){return service.receiptInboundReplySend(token,r);}
 @PostMapping("/api/local-connector/runtime/approved-draft-fill/claim")public ApprovedDraftFillClaimResponse claimDraftFill(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody ApprovedDraftFillClaimRequest r){return service.claimApprovedDraftFill(token,r);}
 @PostMapping("/api/local-connector/runtime/approved-draft-fill/receipt")public ApprovedDraftFillReceiptResponse receiptDraftFill(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody ApprovedDraftFillReceiptRequest r){return service.receiptApprovedDraftFill(token,r);}
 @GetMapping("/api/local-connector/observations")public List<UnreadObservationResponse> observations(){return service.listUnreadObservations();}
 @GetMapping("/api/local-connector/ai-duty-replies")public List<AiDutyReplyResponse> aiDutyReplies(){return service.listRecentAiDutyReplies();}
 @GetMapping("/api/local-connector/ai-duty-review-required")public List<AiDutyReviewRequiredResponse> aiDutyReviewRequired(){return service.listRecentAiDutyReviewRequired();}
 @GetMapping("/api/local-connector/ai-reply-quality-summary")public InboundReplyQualitySummaryResponse aiReplyQualitySummary(){return service.inboundReplyQualitySummary();}
 @GetMapping("/api/local-connector/observations/unmatched-job-groups")public List<UnmatchedJobGroupResponse> unmatchedJobGroups(){return service.listUnmatchedJobGroups();}
 @PutMapping("/api/local-connector/observations/manual-job-match")public ManualJobMatchResponse manualJobMatch(@Valid@RequestBody ManualJobMatchRequest r){return service.manualJobMatch(r);}
 @PostMapping("/api/local-connector/observations/recalculate-drafts")public DraftRecalculationResponse recalculateDrafts(){return service.recalculateDrafts();}
 @PutMapping("/api/local-connector/observations/{id}/review")public UnreadObservationResponse review(@PathVariable UUID id,@Valid@RequestBody ObservationReviewRequest r){return service.reviewObservation(id,r);}
 @PostMapping("/api/local-connector/observations/{id}/cycle-test/start")public UnreadObservationResponse startCycleTest(@PathVariable UUID id,@Valid@RequestBody CycleTestStartRequest r){return service.startCycleTest(id,r);}
 @PostMapping("/api/local-connector/observations/{id}/cycle-test/cancel")public UnreadObservationResponse cancelCycleTest(@PathVariable UUID id,@Valid@RequestBody CycleTestCancelRequest r){return service.cancelCycleTest(id,r);}
 @PutMapping("/api/local-connector/observations/{id}/cycle-test/resume-review")public UnreadObservationResponse reviewCycleResume(@PathVariable UUID id,@Valid@RequestBody CycleResumeReviewRequest r){return service.reviewCycleResume(id,r);}
 @GetMapping("/api/local-connector/capabilities")public List<ConnectorCapabilityResponse> capabilities(){return service.listCapabilities();}
 @GetMapping("/api/local-connector/action-tasks")public List<ConnectorActionTaskResponse> actions(){return service.listActionTasks();}
 @PostMapping("/api/local-connector/action-tasks")public ConnectorActionTaskResponse createAction(@Valid@RequestBody CreateActionTaskRequest r){return service.createActionTask(r);}
 @GetMapping("/api/local-connector/validation-cases")public List<ConnectorValidationCaseResponse> validations(){return service.listValidationCases();}
 @PostMapping("/api/local-connector/runtime/validation-readiness")public ConnectorValidationCaseResponse readiness(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody ValidationReadinessRequest r){return service.reportValidationReadiness(token,r);}
 @PostMapping("/api/local-connector/validation-cases/{id}/start")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public ConnectorValidationCaseResponse startValidation(@PathVariable UUID id){return service.startValidation(id);}
 @PostMapping("/api/local-connector/validation-cases/{id}/result")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public ConnectorValidationCaseResponse validationResult(@PathVariable UUID id,@Valid@RequestBody ValidationResultRequest r){return service.completeValidation(id,r);}
}
