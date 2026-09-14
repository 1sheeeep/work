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
    @Column(name="client_type",nullable=false,length=40) private String clientType;
    @Column(name="client_version",length=32) private String clientVersion;
    @Column(nullable=false,length=16) private String status;
    @Column(name="runtime_state",nullable=false,length=24) private String runtimeState;
    @Column(name="stop_reason",length=300) private String stopReason;
    @Column(name="page_context",nullable=false,length=24) private String pageContext;
    @Column(name="last_heartbeat_at") private Instant lastHeartbeatAt;
    @Column(name="last_successful_sync_at") private Instant lastSuccessfulSyncAt;
    @Column(name="last_successful_sync_type",length=16) private String lastSuccessfulSyncType;
    @Column(name="last_successful_chat_sync_at") private Instant lastSuccessfulChatSyncAt;
    @Column(name="last_successful_job_sync_at") private Instant lastSuccessfulJobSyncAt;
    @Column(name="last_pause_at") private Instant lastPauseAt;
    @Column(name="last_pause_reason",length=300) private String lastPauseReason;
    @Column(name="recovery_required_since") private Instant recoveryRequiredSince;
    @Column(name="last_recovered_at") private Instant lastRecoveredAt;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="paired_by") private SystemUser pairedBy;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="revoked_at") private Instant revokedAt;
    protected BrowserDevice(){}
    public BrowserDevice(BossAccount account,String name,String hash,String type,String version,SystemUser user){id=UUID.randomUUID();bossAccount=account;displayName=name;tokenHash=hash;clientType=type;clientVersion=version;status="ACTIVE";runtimeState="OFFLINE";pageContext="NO_BOSS_PAGE";pairedBy=user;createdAt=Instant.now();}
    public void heartbeat(String state,String reason,String context){heartbeat(state,reason,context,Instant.now());}
    void observeClientVersion(String value){if(value!=null&&!value.isBlank())clientVersion=value;}
    void heartbeat(String state,String reason,String context,Instant now){
        runtimeState=state;stopReason=reason;pageContext=context;lastHeartbeatAt=now;
        if(!"RUNNING".equals(state))markRecoveryRequired(reason,now);
    }
    boolean recordSuccessfulSync(String type,Instant now){
        lastSuccessfulSyncAt=now;lastSuccessfulSyncType=type;
        if("CHAT".equals(type))lastSuccessfulChatSyncAt=now;
        if("JOB".equals(type))lastSuccessfulJobSyncAt=now;
        if("CHAT".equals(type)&&recoveryRequiredSince!=null&&!now.isBefore(recoveryRequiredSince)){
            recoveryRequiredSince=null;lastRecoveredAt=now;return true;
        }
        return false;
    }
    private void markRecoveryRequired(String reason,Instant now){
        if(recoveryRequiredSince==null)recoveryRequiredSince=now;
        lastPauseAt=now;
        if(reason!=null&&!reason.isBlank())lastPauseReason=reason;
    }
    boolean markOffline(String reason){return markOffline(reason,Instant.now());}
    boolean markOffline(String reason,Instant now){
        if("OFFLINE".equals(runtimeState)&&java.util.Objects.equals(stopReason,reason))return false;
        runtimeState="OFFLINE";stopReason=reason;markRecoveryRequired(reason,now);return true;
    }
    public void revoke(){status="REVOKED";runtimeState="OFFLINE";revokedAt=Instant.now();tokenHash=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");}
    public UUID getId(){return id;} public BossAccount getBossAccount(){return bossAccount;} public String getDisplayName(){return displayName;} public String getTokenHash(){return tokenHash;} public String getClientType(){return clientType;} public String getClientVersion(){return clientVersion;} public String getStatus(){return status;} public String getRuntimeState(){return runtimeState;} public String getStopReason(){return stopReason;} public String getPageContext(){return pageContext;} public Instant getLastHeartbeatAt(){return lastHeartbeatAt;} public Instant getLastSuccessfulSyncAt(){return lastSuccessfulSyncAt;} public String getLastSuccessfulSyncType(){return lastSuccessfulSyncType;} public Instant getLastSuccessfulChatSyncAt(){return lastSuccessfulChatSyncAt;} public Instant getLastSuccessfulJobSyncAt(){return lastSuccessfulJobSyncAt;} public Instant getLastPauseAt(){return lastPauseAt;} public String getLastPauseReason(){return lastPauseReason;} public Instant getRecoveryRequiredSince(){return recoveryRequiredSince;} public Instant getLastRecoveredAt(){return lastRecoveredAt;} public Instant getCreatedAt(){return createdAt;} public Instant getRevokedAt(){return revokedAt;}
}
