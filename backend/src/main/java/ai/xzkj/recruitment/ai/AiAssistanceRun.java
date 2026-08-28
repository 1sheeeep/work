package ai.xzkj.recruitment.ai;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.jobs.JobPosition;
import jakarta.persistence.*;
import java.time.Instant;import java.util.UUID;
@Entity @Table(name="ai_assistance_runs")
public class AiAssistanceRun{
 @Id private UUID id;@Column(name="assistance_type",nullable=false,length=24)private String assistanceType;@ManyToOne(fetch=FetchType.LAZY)@JoinColumn(name="job_position_id")private JobPosition jobPosition;@ManyToOne(fetch=FetchType.LAZY)@JoinColumn(name="candidate_contact_id")private CandidateJobContact candidateContact;@Column(nullable=false,length=40)private String provider;@Column(name="model_version",nullable=false,length=80)private String modelVersion;@Column(name="prompt_version",nullable=false,length=80)private String promptVersion;@Column(name="input_hash",nullable=false,length=64)private String inputHash;@Column(nullable=false,length=16)private String status;@Column(length=16)private String outcome;@Column(columnDefinition="TEXT")private String rationale;@Column(name="structured_result",columnDefinition="TEXT")private String structuredResult;@Column(name="error_message",length=1000)private String errorMessage;@ManyToOne(fetch=FetchType.LAZY,optional=false)@JoinColumn(name="created_by")private SystemUser createdBy;@Column(name="created_at",nullable=false)private Instant createdAt;
 protected AiAssistanceRun(){}public AiAssistanceRun(String type,JobPosition job,CandidateJobContact contact,String provider,String model,String prompt,String hash,String status,String outcome,String rationale,String result,String error,SystemUser user){id=UUID.randomUUID();assistanceType=type;jobPosition=job;candidateContact=contact;this.provider=provider;modelVersion=model;promptVersion=prompt;inputHash=hash;this.status=status;this.outcome=outcome;this.rationale=rationale;structuredResult=result;errorMessage=error;createdBy=user;createdAt=Instant.now();}
 public UUID getId(){return id;}
}
