package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

interface ConversationLocationRequestRepository extends JpaRepository<ConversationLocationRequest,UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @EntityGraph(attributePaths={"observation","device","device.bossAccount"})
    Optional<ConversationLocationRequest> findFirstByDeviceIdAndStatusAndExpiresAtAfterOrderByCreatedAtAsc(UUID deviceId,String status,Instant now);
    @EntityGraph(attributePaths={"observation","device"}) Optional<ConversationLocationRequest> findWithObservationById(UUID id);
    List<ConversationLocationRequest> findByStatusInAndExpiresAtBefore(Collection<String> statuses,Instant now);
}

record ConversationLocationResponse(UUID id,String status,String reason,Instant expiresAt){}
record ConversationLocationClaimResponse(UUID id,String chatDigest,Instant expiresAt){static ConversationLocationClaimResponse none(){return new ConversationLocationClaimResponse(null,null,null);}}
record ConversationLocationReceipt(@NotNull UUID id,boolean success,@NotBlank@Size(max=300)String reason){}

@RestController
class ConversationLocationController {
    private final ConversationLocationRequestRepository requests; private final BrowserUnreadObservationRepository observations;
    private final BrowserDeviceRepository devices; private final CurrentUserService users;
    ConversationLocationController(ConversationLocationRequestRepository requests,BrowserUnreadObservationRepository observations,BrowserDeviceRepository devices,CurrentUserService users){this.requests=requests;this.observations=observations;this.devices=devices;this.users=users;}

    @PostMapping("/api/local-connector/observations/{id}/locate") @Transactional
    ConversationLocationResponse create(@PathVariable UUID id){
        var user=users.requireCurrentUser();var observation=observations.findWithAccountById(id).orElseThrow(()->error(HttpStatus.NOT_FOUND,"会话不存在或已过期"));
        UUID companyId=observation.getAccount().getCompany().getId();
        if(user.getRole()!=UserRole.SYSTEM_ADMIN&&user.getCompanyScopes().stream().map(Company::getId).noneMatch(companyId::equals))throw error(HttpStatus.FORBIDDEN,"无权访问该会话");
        BrowserDevice device=observation.getDevice();if(device==null||!"ACTIVE".equals(device.getStatus()))throw error(HttpStatus.CONFLICT,"对应浏览器扩展当前不可用");
        Instant now=Instant.now();ConversationLocationRequest request=requests.save(new ConversationLocationRequest(observation,device,now));
        return new ConversationLocationResponse(request.getId(),request.getStatus(),"定位请求已发送到对应扩展",request.getExpiresAt());
    }

    @GetMapping("/api/local-connector/runtime/conversation-locations/claim") @Transactional
    ConversationLocationClaimResponse claim(@RequestHeader(HttpHeaders.AUTHORIZATION)String authorization){
        BrowserDevice device=authenticate(authorization);Instant deadline=Instant.now().plusSeconds(18);
        while(Instant.now().isBefore(deadline)){
            ConversationLocationRequest request=requests.findFirstByDeviceIdAndStatusAndExpiresAtAfterOrderByCreatedAtAsc(device.getId(),"PENDING",Instant.now()).orElse(null);
            if(request!=null){request.claim(Instant.now());return new ConversationLocationClaimResponse(request.getId(),request.getObservation().getChatDigest(),request.getExpiresAt());}
            try{Thread.sleep(250);}catch(InterruptedException e){Thread.currentThread().interrupt();break;}
        }
        return ConversationLocationClaimResponse.none();
    }

    @PostMapping("/api/local-connector/runtime/conversation-locations/receipt") @Transactional
    ConversationLocationResponse receipt(@RequestHeader(HttpHeaders.AUTHORIZATION)String authorization,@Valid@RequestBody ConversationLocationReceipt receipt){
        BrowserDevice device=authenticate(authorization);ConversationLocationRequest request=requests.findWithObservationById(receipt.id()).orElseThrow(()->error(HttpStatus.NOT_FOUND,"定位请求不存在"));
        if(!request.getDevice().getId().equals(device.getId()))throw error(HttpStatus.FORBIDDEN,"定位请求不属于当前扩展");
        request.complete(receipt.success(),receipt.reason(),Instant.now());return new ConversationLocationResponse(request.getId(),request.getStatus(),request.getResultReason(),request.getExpiresAt());
    }

    private BrowserDevice authenticate(String authorization){if(authorization==null||!authorization.startsWith("Device "))throw error(HttpStatus.UNAUTHORIZED,"扩展未配对");String hash;try{hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(authorization.substring(7).trim().getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}return devices.findByTokenHashAndStatus(hash,"ACTIVE").orElseThrow(()->error(HttpStatus.UNAUTHORIZED,"扩展凭据无效"));}
    private ApiException error(HttpStatus status,String message){return new ApiException(status,"CONVERSATION_LOCATION_FAILED",message);}
}
