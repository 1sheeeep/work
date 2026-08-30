package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.*;
import java.time.Instant;
import ai.xzkj.recruitment.auth.SystemUser;
import java.util.UUID;

@Entity
@Table(name="local_connector_validation_cases")
class LocalConnectorValidationCase {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="local_connector_device_id") private BrowserDevice device;
    @Column(name="action_type",nullable=false,length=32) private String actionType;
    @Column(nullable=false,length=24) private String status;
    @Column(nullable=false,columnDefinition="TEXT") private String prerequisites;
    @Column(name="expected_result",nullable=false,length=500) private String expectedResult;
    @Column(name="page_evidence_digest",length=64) private String pageEvidenceDigest;
    @Column(name="control_evidence_digest",length=64) private String controlEvidenceDigest;
    @Column(name="evidence_observed_at") private Instant evidenceObservedAt;
    @Column(name="last_failure_reason",length=500) private String lastFailureReason;
    @Column(name="test_started_at") private Instant testStartedAt;
    @Column(name="test_expires_at") private Instant testExpiresAt;
    @Column(name="completed_at") private Instant completedAt;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="completed_by") private SystemUser completedBy;
    @Column(name="result_note",length=500) private String resultNote;
    @Column(name="prepared_at",nullable=false) private Instant preparedAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorValidationCase() {}
    LocalConnectorValidationCase(BrowserDevice device,String actionType,String prerequisites,String expectedResult){this.id=UUID.randomUUID();this.device=device;this.actionType=actionType;this.status="WAITING_REAL_PAGE";this.prerequisites=prerequisites;this.expectedResult=expectedResult;this.preparedAt=Instant.now();this.updatedAt=this.preparedAt;}
    void prepare(String pageDigest,String controlDigest,Instant now){if("MANUAL_TEST_RUNNING".equals(status))throw new IllegalStateException("人工验收正在进行");status="PREPARED";pageEvidenceDigest=pageDigest;controlEvidenceDigest=controlDigest;evidenceObservedAt=now;lastFailureReason=null;testStartedAt=null;testExpiresAt=null;completedAt=null;completedBy=null;resultNote=null;updatedAt=now;}
    void start(SystemUser user,Instant now){if(!"PREPARED".equals(status))throw new IllegalStateException("页面尚未准备完成");if(evidenceObservedAt==null||evidenceObservedAt.isBefore(now.minusSeconds(120)))throw new IllegalStateException("页面就绪证据已过期");status="MANUAL_TEST_RUNNING";testStartedAt=now;testExpiresAt=now.plusSeconds(600);completedBy=user;updatedAt=now;}
    void complete(boolean passed,String note,SystemUser user,Instant now){if(!"MANUAL_TEST_RUNNING".equals(status))throw new IllegalStateException("人工验收尚未开始");if(testExpiresAt==null||now.isAfter(testExpiresAt)){fail("人工验收窗口已过期",user,now);return;}status=passed?"PASSED":"FAILED";lastFailureReason=passed?null:note;resultNote=note;completedAt=now;completedBy=user;updatedAt=now;}
    void fail(String reason,SystemUser user,Instant now){status="FAILED";lastFailureReason=reason;resultNote=reason;completedAt=now;completedBy=user;updatedAt=now;}
    UUID getId(){return id;} BrowserDevice getDevice(){return device;} String getActionType(){return actionType;} String getStatus(){return status;} String getPrerequisites(){return prerequisites;} String getExpectedResult(){return expectedResult;} String getPageEvidenceDigest(){return pageEvidenceDigest;} String getLastFailureReason(){return lastFailureReason;} Instant getPreparedAt(){return preparedAt;} Instant getUpdatedAt(){return updatedAt;} Instant getEvidenceObservedAt(){return evidenceObservedAt;} Instant getTestStartedAt(){return testStartedAt;} Instant getTestExpiresAt(){return testExpiresAt;} Instant getCompletedAt(){return completedAt;} String getResultNote(){return resultNote;}
}
