package ai.xzkj.recruitment.browsercompanion;

import ai.xzkj.recruitment.candidates.ConversationMessage;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="browser_send_claims")
public class BrowserSendClaim {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="browser_device_id") private BrowserDevice device;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="binding_id") private BrowserConversationBinding binding;
    @OneToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="inbound_message_id") private ConversationMessage inboundMessage;
    @Column(name="reply_digest",nullable=false,length=64) private String replyDigest;
    @Column(nullable=false,length=16) private String status;
    @Column(name="claimed_at",nullable=false) private Instant claimedAt;
    @Column(name="lease_until",nullable=false) private Instant leaseUntil;
    @Column(name="completed_at") private Instant completedAt;
    @OneToOne(fetch=FetchType.LAZY) @JoinColumn(name="outbound_message_id") private ConversationMessage outboundMessage;
    protected BrowserSendClaim() {}
    BrowserSendClaim(BrowserDevice device,BrowserConversationBinding binding,ConversationMessage inbound,String digest,Instant now){
        id=UUID.randomUUID();this.device=device;this.binding=binding;inboundMessage=inbound;replyDigest=digest;status="CLAIMED";claimedAt=now;leaseUntil=now.plusSeconds(45);
    }
    void sent(ConversationMessage outbound,Instant now){status="SENT";outboundMessage=outbound;completedAt=now;}
    void unknown(Instant now){status="UNKNOWN";completedAt=now;}
    public UUID getId(){return id;} public String getStatus(){return status;} public Instant getLeaseUntil(){return leaseUntil;}
    public BrowserConversationBinding getBinding(){return binding;} public ConversationMessage getInboundMessage(){return inboundMessage;}
}
