package ai.xzkj.recruitment.browsercompanion;
import jakarta.validation.Valid;import org.springframework.http.HttpHeaders;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.web.bind.annotation.*;import java.util.*;
@RestController public class BrowserCompanionController{
 private final BrowserCompanionService service;public BrowserCompanionController(BrowserCompanionService s){service=s;}
 @GetMapping("/api/browser-devices")public List<DeviceResponse> list(){return service.list();}
 @PostMapping("/api/browser-devices/pairings")public PairingResponse create(@Valid@RequestBody CreatePairingRequest r){return service.createPairing(r.accountId());}
 @DeleteMapping("/api/browser-devices/{id}")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public void revoke(@PathVariable UUID id){service.revoke(id);}
 @PostMapping("/api/browser-devices/{accountId}/bindings")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public BindingResponse bind(@PathVariable UUID accountId,@Valid@RequestBody BindConversationRequest r){return service.bind(accountId,r);}
 @PostMapping("/api/browser-runtime/pair")public DeviceCredentialsResponse pair(@Valid@RequestBody PairDeviceRequest r){return service.pair(r);}
 @PostMapping("/api/browser-runtime/heartbeat")public DeviceResponse heartbeat(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody HeartbeatRequest r){return service.heartbeat(token,r);}
 @GetMapping("/api/browser-runtime/policy")public BrowserRuntimePolicyResponse policy(@RequestHeader(HttpHeaders.AUTHORIZATION)String token){return service.runtimePolicy(token);}
 @PostMapping("/api/browser-runtime/messages")public SyncMessageResponse sync(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody SyncMessageRequest r){return service.sync(token,r);}
 @PostMapping("/api/browser-runtime/unread-observations")public UnreadObservationSyncResponse observations(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody UnreadObservationSnapshot r){return service.observeUnread(token,r);}
 @PostMapping("/api/browser-runtime/selected-conversation")public UnreadObservationResponse selected(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody SelectedConversationSnapshot r){return service.verifySelectedConversation(token,r);}
 @GetMapping("/api/browser-observations")public List<UnreadObservationResponse> observations(){return service.listUnreadObservations();}
 @PutMapping("/api/browser-observations/{id}/review")public UnreadObservationResponse review(@PathVariable UUID id,@Valid@RequestBody ObservationReviewRequest r){return service.reviewObservation(id,r);}
 @PostMapping("/api/browser-runtime/draft-fill-claims")public DraftFillClaimResponse claimDraft(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody DraftFillClaimRequest r){return service.claimDraftFill(token,r);}
 @PostMapping("/api/browser-runtime/draft-fill-claims/{id}/receipt")public DraftFillReceiptResponse draftReceipt(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@PathVariable UUID id,@Valid@RequestBody DraftFillReceiptRequest r){return service.draftFillReceipt(token,id,r);}
 @PostMapping("/api/browser-runtime/job-drafts")public CapturedJobDraftResponse captureJob(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody CapturedJobDraftRequest r){return service.createCapturedJobDraft(token,r);}
 @PostMapping("/api/browser-runtime/send-claims")public SendClaimResponse claim(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody CreateSendClaimRequest r){return service.claim(token,r);}
 @PostMapping("/api/browser-runtime/send-claims/{id}/receipt")public SendReceiptResponse receipt(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@PathVariable UUID id,@Valid@RequestBody SendReceiptRequest r){return service.receipt(token,id,r);}
}
