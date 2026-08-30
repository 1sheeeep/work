package ai.xzkj.recruitment.localconnector;
import jakarta.validation.Valid;import org.springframework.http.HttpHeaders;import org.springframework.security.access.prepost.PreAuthorize;import org.springframework.web.bind.annotation.*;import java.util.*;
@RestController public class LocalConnectorController{
 private final LocalConnectorService service;public LocalConnectorController(LocalConnectorService s){service=s;}
 @GetMapping("/api/local-connector/devices")public List<DeviceResponse> list(){return service.list();}
 @PostMapping("/api/local-connector/devices/pairings")public PairingResponse create(@Valid@RequestBody CreatePairingRequest r){return service.createPairing(r.accountId());}
 @DeleteMapping("/api/local-connector/devices/{id}")@PreAuthorize("hasAnyRole('SYSTEM_ADMIN','RECRUITMENT_ADMIN')")public void revoke(@PathVariable UUID id){service.revoke(id);}
 @PostMapping("/api/local-connector/runtime/pair")public DeviceCredentialsResponse pair(@Valid@RequestBody PairDeviceRequest r){return service.pair(r);}
 @PostMapping("/api/local-connector/runtime/heartbeat")public DeviceResponse heartbeat(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody HeartbeatRequest r){return service.heartbeat(token,r);}
 @PostMapping("/api/local-connector/runtime/unread-observations")public UnreadObservationSyncResponse observations(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody UnreadObservationSnapshot r){return service.observeUnread(token,r);}
 @PostMapping("/api/local-connector/runtime/selected-conversation")public UnreadObservationResponse selected(@RequestHeader(HttpHeaders.AUTHORIZATION)String token,@Valid@RequestBody SelectedConversationSnapshot r){return service.verifySelectedConversation(token,r);}
 @GetMapping("/api/local-connector/observations")public List<UnreadObservationResponse> observations(){return service.listUnreadObservations();}
 @PutMapping("/api/local-connector/observations/{id}/review")public UnreadObservationResponse review(@PathVariable UUID id,@Valid@RequestBody ObservationReviewRequest r){return service.reviewObservation(id,r);}
}
