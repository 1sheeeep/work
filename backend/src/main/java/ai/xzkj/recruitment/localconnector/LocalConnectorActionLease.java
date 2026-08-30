package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="local_connector_action_leases")
class LocalConnectorActionLease {
    @Id private UUID id;
    @OneToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="action_task_id") private LocalConnectorActionTask task;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="local_connector_device_id") private BrowserDevice device;
    @Column(name="lease_token_hash",nullable=false,length=64) private String leaseTokenHash;
    @Column(nullable=false,length=24) private String status;
    @Column(name="leased_at",nullable=false) private Instant leasedAt;
    @Column(name="lease_until",nullable=false) private Instant leaseUntil;
    @Column(name="receipt_digest",length=64) private String receiptDigest;
    @Column(name="result_reason",length=300) private String resultReason;
    @Column(name="completed_at") private Instant completedAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorActionLease(){}
    LocalConnectorActionLease(LocalConnectorActionTask task,BrowserDevice device,String tokenHash,Instant now){id=UUID.randomUUID();this.task=task;this.device=device;leaseTokenHash=tokenHash;status="CLAIMED";leasedAt=now;leaseUntil=now.plusSeconds(30);updatedAt=now;task.lease(now);}
    boolean receipt(String outcome,String digest,String reason,Instant now){if(!"CLAIMED".equals(status)){if(java.util.Objects.equals(status,outcome)&&java.util.Objects.equals(receiptDigest,digest))return false;throw new IllegalStateException("租约已有不同结果，禁止覆盖");}if(now.isAfter(leaseUntil)){expire(now);return true;}status=outcome;receiptDigest=digest;resultReason=reason;completedAt=now;updatedAt=now;task.complete(outcome,reason,now);if("UNKNOWN".equals(outcome))device.markOffline("页面操作结果无法确认，已冻结当前账号并禁止自动重试");return true;}
    void expire(Instant now){if(!"CLAIMED".equals(status))return;status="EXPIRED";resultReason="动作租约超时且未收到明确回执";completedAt=now;updatedAt=now;task.complete("UNKNOWN",resultReason,now);device.markOffline("动作租约超时，页面结果未知，已冻结当前账号并禁止自动重试");}
    UUID getId(){return id;} LocalConnectorActionTask getTask(){return task;} BrowserDevice getDevice(){return device;} String getStatus(){return status;} Instant getLeasedAt(){return leasedAt;} Instant getLeaseUntil(){return leaseUntil;} String getReceiptDigest(){return receiptDigest;} String getResultReason(){return resultReason;} Instant getCompletedAt(){return completedAt;} Instant getUpdatedAt(){return updatedAt;}
}
