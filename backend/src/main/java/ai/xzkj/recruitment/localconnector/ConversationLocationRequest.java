package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name="conversation_location_requests")
class ConversationLocationRequest {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="observation_id") private BrowserUnreadObservation observation;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="device_id") private BrowserDevice device;
    @Column(nullable=false,length=16) private String status;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="claimed_at") private Instant claimedAt;
    @Column(name="completed_at") private Instant completedAt;
    @Column(name="expires_at",nullable=false) private Instant expiresAt;
    @Column(name="result_reason",length=300) private String resultReason;
    protected ConversationLocationRequest() {}
    ConversationLocationRequest(BrowserUnreadObservation observation, BrowserDevice device, Instant now) {
        id=UUID.randomUUID();this.observation=observation;this.device=device;status="PENDING";createdAt=now;expiresAt=now.plusSeconds(45);
    }
    void claim(Instant now){status="CLAIMED";claimedAt=now;}
    void complete(boolean success,String reason,Instant now){status=success?"SUCCEEDED":"FAILED";resultReason=clean(reason);completedAt=now;}
    void expire(Instant now){if(List.of("PENDING","CLAIMED").contains(status)){status="FAILED";resultReason="定位请求已过期，请重试";completedAt=now;}}
    private String clean(String value){String text=value==null?"定位失败":value.replace('\n',' ').replace('\r',' ').trim();return text.substring(0,Math.min(300,text.length()));}
    UUID getId(){return id;} BrowserUnreadObservation getObservation(){return observation;} BrowserDevice getDevice(){return device;} String getStatus(){return status;} Instant getCreatedAt(){return createdAt;} Instant getExpiresAt(){return expiresAt;} String getResultReason(){return resultReason;}
}
