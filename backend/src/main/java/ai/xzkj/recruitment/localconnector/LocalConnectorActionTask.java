package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="local_connector_action_tasks")
class LocalConnectorActionTask {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="boss_account_id") private BossAccount account;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="unread_observation_id") private BrowserUnreadObservation observation;
    @Column(name="action_type",nullable=false,length=32) private String actionType;
    @Column(nullable=false,length=32) private String status;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="requested_by") private SystemUser requestedBy;
    @Column(nullable=false,length=24) private String origin;
    @Column(columnDefinition="TEXT") private String payload;
    @Column(name="cycle_started_at") private Instant cycleStartedAt;
    @Column(nullable=false,length=300) private String reason;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorActionTask() {}
    LocalConnectorActionTask(BossAccount account,BrowserUnreadObservation observation,String actionType,String status,SystemUser user,String reason){this(account,observation,actionType,status,user,"MANUAL","SEND_MESSAGE".equals(actionType)&&observation!=null?observation.getReviewedContent():null,reason);}
    static LocalConnectorActionTask unattended(BrowserUnreadObservation observation,String actionType,String status,String payload,String reason){return new LocalConnectorActionTask(observation.getAccount(),observation,actionType,status,null,"UNATTENDED",payload,reason);}
    private LocalConnectorActionTask(BossAccount account,BrowserUnreadObservation observation,String actionType,String status,SystemUser user,String origin,String payload,String reason){this.id=UUID.randomUUID();this.account=account;this.observation=observation;this.actionType=actionType;this.status=status;this.requestedBy=user;this.origin=origin;this.payload=payload;this.cycleStartedAt=observation==null?null:observation.getFirstSeenAt();this.reason=reason;this.createdAt=Instant.now();this.updatedAt=this.createdAt;}
    void lease(Instant now){if(!"READY".equals(status))throw new IllegalStateException("动作任务尚未批准执行");status="LEASED";reason="已签发 30 秒单次动作租约";updatedAt=now;}
    void ready(String reason,Instant now){if(!"BLOCKED_UNVERIFIED".equals(status)&&!"WAITING_MANUAL_TEST".equals(status))return;status="READY";this.reason=reason;updatedAt=now;}
    void complete(String outcome,String result,Instant now){if(!"LEASED".equals(status))throw new IllegalStateException("动作任务不在租约执行中");status=outcome;reason=result;updatedAt=now;}
    UUID getId(){return id;} BossAccount getAccount(){return account;} BrowserUnreadObservation getObservation(){return observation;} String getActionType(){return actionType;} String getStatus(){return status;} SystemUser getRequestedBy(){return requestedBy;} String getOrigin(){return origin;} String getPayload(){return payload;} Instant getCycleStartedAt(){return cycleStartedAt;} String getReason(){return reason;} Instant getCreatedAt(){return createdAt;} Instant getUpdatedAt(){return updatedAt;}
}
