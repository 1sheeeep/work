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
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="requested_by") private SystemUser requestedBy;
    @Column(nullable=false,length=300) private String reason;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorActionTask() {}
    LocalConnectorActionTask(BossAccount account,BrowserUnreadObservation observation,String actionType,String status,SystemUser user,String reason){this.id=UUID.randomUUID();this.account=account;this.observation=observation;this.actionType=actionType;this.status=status;this.requestedBy=user;this.reason=reason;this.createdAt=Instant.now();this.updatedAt=this.createdAt;}
    UUID getId(){return id;} BossAccount getAccount(){return account;} BrowserUnreadObservation getObservation(){return observation;} String getActionType(){return actionType;} String getStatus(){return status;} SystemUser getRequestedBy(){return requestedBy;} String getReason(){return reason;} Instant getCreatedAt(){return createdAt;} Instant getUpdatedAt(){return updatedAt;}
}
