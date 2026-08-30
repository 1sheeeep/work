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
 protected ResumeIntake(){} ResumeIntake(CandidateJobContact contact,ResumeIntakeSource source,String digest,String label,Instant received){id=UUID.randomUUID();this.contact=contact;this.source=source;resumeDigest=digest;displayLabel=label;status=ResumeIntakeStatus.PENDING_REVIEW;receivedAt=received;createdAt=Instant.now();updatedAt=createdAt;}
 void review(ResumeIntakeStatus decision,String note,SystemUser reviewer,Instant now){status=decision;reviewNote=note;reviewedBy=reviewer;reviewedAt=now;updatedAt=now;} @PreUpdate void preUpdate(){updatedAt=Instant.now();}
 public UUID getId(){return id;}public CandidateJobContact getContact(){return contact;}public ResumeIntakeSource getSource(){return source;}public String getResumeDigest(){return resumeDigest;}public String getDisplayLabel(){return displayLabel;}public ResumeIntakeStatus getStatus(){return status;}public Instant getReceivedAt(){return receivedAt;}public SystemUser getReviewedBy(){return reviewedBy;}public Instant getReviewedAt(){return reviewedAt;}public String getReviewNote(){return reviewNote;}public Instant getCreatedAt(){return createdAt;}
}
