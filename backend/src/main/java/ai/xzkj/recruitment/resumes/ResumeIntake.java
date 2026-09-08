package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="resume_intakes") public class ResumeIntake {
 @Id private UUID id;@ManyToOne(fetch=FetchType.LAZY,optional=false)@JoinColumn(name="contact_id")private CandidateJobContact contact;@Enumerated(EnumType.STRING)@Column(nullable=false,length=24)private ResumeIntakeSource source;@JdbcTypeCode(SqlTypes.CHAR)@Column(name="resume_digest",nullable=false,length=64,columnDefinition="CHAR(64)")private String resumeDigest;@Column(name="display_label",nullable=false,length=120)private String displayLabel;@Enumerated(EnumType.STRING)@Column(nullable=false,length=24)private ResumeIntakeStatus status;@Column(name="received_at",nullable=false)private Instant receivedAt;@ManyToOne(fetch=FetchType.LAZY)@JoinColumn(name="reviewed_by")private SystemUser reviewedBy;@Column(name="reviewed_at")private Instant reviewedAt;@Column(name="review_note",length=500)private String reviewNote;@Column(name="created_at",nullable=false)private Instant createdAt;@Column(name="updated_at",nullable=false)private Instant updatedAt;
 @Column(name="processing_status",nullable=false,length=32)private String processingStatus="RECEIVED";@Column(name="document_type",length=24)private String documentType;@Column(name="malware_scanned",nullable=false)private boolean malwareScanned;@JdbcTypeCode(SqlTypes.CHAR)@Column(name="extracted_text_digest",length=64,columnDefinition="CHAR(64)")private String extractedTextDigest;@Column(name="failure_code",length=80)private String failureCode;@Column(name="failure_reason",length=300)private String failureReason;@Column(name="processed_at")private Instant processedAt;
 @JdbcTypeCode(SqlTypes.VARBINARY)@Column(name="source_pdf",columnDefinition="bytea")private byte[] sourcePdf;
 @JdbcTypeCode(SqlTypes.CHAR)@Column(name="source_event_digest",length=64,columnDefinition="CHAR(64)")private String sourceEventDigest;
 @Column(name="source_action_task_id")private UUID sourceActionTaskId;
 @Column(name="analysis_status",nullable=false,length=32)private String analysisStatus="NOT_REQUESTED";@Column(name="analysis_failure_code",length=80)private String analysisFailureCode;@Column(name="analysis_failure_reason",length=300)private String analysisFailureReason;@Column(name="analysis_completed_at")private Instant analysisCompletedAt;
 protected ResumeIntake(){} ResumeIntake(CandidateJobContact contact,ResumeIntakeSource source,String digest,String label,Instant received){id=UUID.randomUUID();this.contact=contact;this.source=source;resumeDigest=digest;displayLabel=label;status=ResumeIntakeStatus.PENDING_REVIEW;receivedAt=received;createdAt=Instant.now();updatedAt=createdAt;}
 void review(ResumeIntakeStatus decision,String note,SystemUser reviewer,Instant now){status=decision;reviewNote=note;reviewedBy=reviewer;reviewedAt=now;updatedAt=now;} @PreUpdate void preUpdate(){updatedAt=Instant.now();}
 void processing(){processingStatus="PROCESSING";failureCode=null;failureReason=null;}
 void attachSourceEvent(String digest){sourceEventDigest=digest;}
 public void attachSourceActionTask(UUID id){sourceActionTaskId=id;}
 void readyForAi(String type,String textDigest,boolean scanned,Instant now){processingStatus="READY_FOR_AI";documentType=type;extractedTextDigest=textDigest;malwareScanned=scanned;failureCode=null;failureReason=null;processedAt=now;}
 void storeSourcePdf(byte[] content){sourcePdf=content == null ? null : content.clone();}
 public byte[] getSourcePdf(){return sourcePdf == null ? null : sourcePdf.clone();}
 void processingFailed(String code,String reason,Instant now){processingStatus="FAILED";failureCode=code;failureReason=reason;processedAt=now;}
 void analysisStarted(){analysisStatus="ANALYZING";analysisFailureCode=null;analysisFailureReason=null;analysisCompletedAt=null;}
 void analysisSucceeded(Instant now){analysisStatus="SUCCEEDED";analysisFailureCode=null;analysisFailureReason=null;analysisCompletedAt=now;}
 void analysisUnavailable(String status,String code,String reason,Instant now){analysisStatus=status;analysisFailureCode=code;analysisFailureReason=reason;analysisCompletedAt=now;}
 public UUID getId(){return id;}public CandidateJobContact getContact(){return contact;}public ResumeIntakeSource getSource(){return source;}public String getResumeDigest(){return resumeDigest;}public String getSourceEventDigest(){return sourceEventDigest;}public UUID getSourceActionTaskId(){return sourceActionTaskId;}public String getDisplayLabel(){return displayLabel;}public ResumeIntakeStatus getStatus(){return status;}public String getProcessingStatus(){return processingStatus;}public String getDocumentType(){return documentType;}public boolean isMalwareScanned(){return malwareScanned;}public String getExtractedTextDigest(){return extractedTextDigest;}public String getFailureCode(){return failureCode;}public String getFailureReason(){return failureReason;}public Instant getProcessedAt(){return processedAt;}public String getAnalysisStatus(){return analysisStatus;}public String getAnalysisFailureCode(){return analysisFailureCode;}public String getAnalysisFailureReason(){return analysisFailureReason;}public Instant getAnalysisCompletedAt(){return analysisCompletedAt;}public Instant getReceivedAt(){return receivedAt;}public SystemUser getReviewedBy(){return reviewedBy;}public Instant getReviewedAt(){return reviewedAt;}public String getReviewNote(){return reviewNote;}public Instant getCreatedAt(){return createdAt;}
}
