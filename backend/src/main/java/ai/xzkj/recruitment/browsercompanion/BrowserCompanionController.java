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
 @PostMapping("/api/browser-runtime/send-claims")public SendClaimResponse claim(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody CreateSendClaimRequest r){return service.claim(token,r);}
 @PostMapping("/api/browser-runtime/send-claims/{id}/receipt")public SendReceiptResponse receipt(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@PathVariable UUID id,@Valid@RequestBody SendReceiptRequest r){return service.receipt(token,id,r);}
}
