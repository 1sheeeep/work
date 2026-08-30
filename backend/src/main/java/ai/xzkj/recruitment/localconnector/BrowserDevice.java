package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="local_connector_devices")
public class BrowserDevice {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="boss_account_id") private BossAccount bossAccount;
    @Column(name="display_name",nullable=false,length=100) private String displayName;
    @Column(name="token_hash",nullable=false,length=64) private String tokenHash;
    @Column(nullable=false,length=16) private String status;
    @Column(name="runtime_state",nullable=false,length=24) private String runtimeState;
    @Column(name="stop_reason",length=300) private String stopReason;
    @Column(name="last_heartbeat_at") private Instant lastHeartbeatAt;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="paired_by") private SystemUser pairedBy;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="revoked_at") private Instant revokedAt;
    protected BrowserDevice(){}
    public BrowserDevice(BossAccount account,String name,String hash,SystemUser user){id=UUID.randomUUID();bossAccount=account;displayName=name;tokenHash=hash;status="ACTIVE";runtimeState="OFFLINE";pairedBy=user;createdAt=Instant.now();}
    public void heartbeat(String state,String reason){runtimeState=state;stopReason=reason;lastHeartbeatAt=Instant.now();}
    boolean markOffline(String reason){
        if("OFFLINE".equals(runtimeState)&&java.util.Objects.equals(stopReason,reason))return false;
        runtimeState="OFFLINE";stopReason=reason;return true;
    }
    public void revoke(){status="REVOKED";runtimeState="OFFLINE";revokedAt=Instant.now();tokenHash=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");}
    public UUID getId(){return id;} public BossAccount getBossAccount(){return bossAccount;} public String getDisplayName(){return displayName;} public String getTokenHash(){return tokenHash;} public String getStatus(){return status;} public String getRuntimeState(){return runtimeState;} public String getStopReason(){return stopReason;} public Instant getLastHeartbeatAt(){return lastHeartbeatAt;} public Instant getCreatedAt(){return createdAt;} public Instant getRevokedAt(){return revokedAt;}
}
