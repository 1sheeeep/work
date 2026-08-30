package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="local_connector_capabilities")
class LocalConnectorCapability {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="local_connector_device_id") private BrowserDevice device;
    @Column(nullable=false,length=40) private String capability;
    @Column(nullable=false,length=32) private String status;
    @Column(name="evidence_digest",length=64) private String evidenceDigest;
    @Column(length=300) private String reason;
    @Column(name="verified_at") private Instant verifiedAt;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorCapability() {}
    LocalConnectorCapability(BrowserDevice device,String capability){this.id=UUID.randomUUID();this.device=device;this.capability=capability;this.status="UNVERIFIED";this.reason="尚未使用真实 BOSS 页面验证";this.createdAt=Instant.now();this.updatedAt=this.createdAt;}
    void verifyReadOnly(String digest,String reason,Instant now){if(isWriteCapability())return;this.status="READ_ONLY_VERIFIED";this.evidenceDigest=digest;this.reason=reason;this.verifiedAt=now;this.updatedAt=now;}
    private boolean isWriteCapability(){return capability.equals("SEND_MESSAGE")||capability.equals("REQUEST_RESUME")||capability.equals("EXCHANGE_WECHAT")||capability.equals("EXCHANGE_PHONE");}
    UUID getId(){return id;} BrowserDevice getDevice(){return device;} String getCapability(){return capability;} String getStatus(){return status;} String getReason(){return reason;} Instant getVerifiedAt(){return verifiedAt;} Instant getUpdatedAt(){return updatedAt;}
}
