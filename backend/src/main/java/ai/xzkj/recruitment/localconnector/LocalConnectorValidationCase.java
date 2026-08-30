package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.*;
import java.time.Instant;
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
    @Column(name="last_failure_reason",length=500) private String lastFailureReason;
    @Column(name="prepared_at",nullable=false) private Instant preparedAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected LocalConnectorValidationCase() {}
    LocalConnectorValidationCase(BrowserDevice device,String actionType,String prerequisites,String expectedResult){this.id=UUID.randomUUID();this.device=device;this.actionType=actionType;this.status="WAITING_REAL_PAGE";this.prerequisites=prerequisites;this.expectedResult=expectedResult;this.preparedAt=Instant.now();this.updatedAt=this.preparedAt;}
    UUID getId(){return id;} BrowserDevice getDevice(){return device;} String getActionType(){return actionType;} String getStatus(){return status;} String getPrerequisites(){return prerequisites;} String getExpectedResult(){return expectedResult;} String getLastFailureReason(){return lastFailureReason;} Instant getPreparedAt(){return preparedAt;} Instant getUpdatedAt(){return updatedAt;}
}
