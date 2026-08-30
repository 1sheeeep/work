package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="local_connector_production_approvals")
class LocalConnectorProductionApproval {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false)@JoinColumn(name="local_connector_device_id")private BrowserDevice device;
    @Column(name="action_type",nullable=false,length=32)private String actionType;
    @Column(nullable=false,length=32)private String status;
    @Column(name="hourly_limit",nullable=false)private int hourlyLimit;
    @Column(name="daily_limit",nullable=false)private int dailyLimit;
    @ManyToOne(fetch=FetchType.LAZY,optional=false)@JoinColumn(name="requested_by")private SystemUser requestedBy;
    @Column(name="requested_at",nullable=false)private Instant requestedAt;
    @ManyToOne(fetch=FetchType.LAZY)@JoinColumn(name="approved_by")private SystemUser approvedBy;
    @Column(name="approved_at")private Instant approvedAt;
    @Column(name="expires_at")private Instant expiresAt;
    @ManyToOne(fetch=FetchType.LAZY)@JoinColumn(name="revoked_by")private SystemUser revokedBy;
    @Column(name="revoked_at")private Instant revokedAt;
    @Column(nullable=false,length=300)private String reason;
    @Column(name="updated_at",nullable=false)private Instant updatedAt;
    protected LocalConnectorProductionApproval(){}
    LocalConnectorProductionApproval(BrowserDevice device,String action,int hourly,int daily,SystemUser requester,String reason,Instant now){id=UUID.randomUUID();this.device=device;actionType=action;hourlyLimit=hourly;dailyLimit=daily;requestedBy=requester;this.reason=reason;status="PENDING_SECOND_APPROVAL";requestedAt=now;updatedAt=now;}
    void renew(int hourly,int daily,SystemUser requester,String newReason,Instant now){if("APPROVED".equals(status))throw new IllegalStateException("当前批准仍在有效期内");hourlyLimit=hourly;dailyLimit=daily;requestedBy=requester;reason=newReason;status="PENDING_SECOND_APPROVAL";requestedAt=now;approvedBy=null;approvedAt=null;expiresAt=null;revokedBy=null;revokedAt=null;updatedAt=now;}
    void approve(SystemUser approver,int durationHours,Instant now){if(!"PENDING_SECOND_APPROVAL".equals(status))throw new IllegalStateException("批准申请不在等待复核状态");if(requestedBy.getId().equals(approver.getId()))throw new IllegalStateException("第二位批准人必须与申请人不同");approvedBy=approver;approvedAt=now;expiresAt=now.plusSeconds(durationHours*3600L);status="APPROVED";updatedAt=now;}
    void revoke(SystemUser user,String why,Instant now){if(!"REVOKED".equals(status)){status="REVOKED";revokedBy=user;revokedAt=now;reason=why;updatedAt=now;}}
    void expire(Instant now){if("APPROVED".equals(status)&&expiresAt!=null&&!expiresAt.isAfter(now)){status="EXPIRED";reason="低配额生产批准已到期";updatedAt=now;}}
    boolean active(Instant now){return "APPROVED".equals(status)&&expiresAt!=null&&expiresAt.isAfter(now);}
    UUID getId(){return id;}BrowserDevice getDevice(){return device;}String getActionType(){return actionType;}String getStatus(){return status;}int getHourlyLimit(){return hourlyLimit;}int getDailyLimit(){return dailyLimit;}SystemUser getRequestedBy(){return requestedBy;}Instant getRequestedAt(){return requestedAt;}SystemUser getApprovedBy(){return approvedBy;}Instant getApprovedAt(){return approvedAt;}Instant getExpiresAt(){return expiresAt;}String getReason(){return reason;}Instant getUpdatedAt(){return updatedAt;}
}
