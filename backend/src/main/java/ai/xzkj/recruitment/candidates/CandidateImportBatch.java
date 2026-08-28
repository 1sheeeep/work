package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.organization.Company;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="candidate_import_batches")
public class CandidateImportBatch {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="company_id") private Company company;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="job_position_id") private JobPosition jobPosition;
    @Column(name="source_filename",nullable=false,length=255) private String sourceFilename;
    @Column(name="file_format",nullable=false,length=8) private String fileFormat;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) private CandidateImportStatus status;
    @Column(name="total_rows",nullable=false) private int totalRows;
    @Column(name="valid_rows",nullable=false) private int validRows;
    @Column(name="invalid_rows",nullable=false) private int invalidRows;
    @Column(name="duplicate_rows",nullable=false) private int duplicateRows;
    @Column(name="imported_rows",nullable=false) private int importedRows;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="created_by") private SystemUser createdBy;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="completed_at") private Instant completedAt;
    protected CandidateImportBatch(){}
    public CandidateImportBatch(Company company,JobPosition job,String filename,String format,SystemUser user){id=UUID.randomUUID();this.company=company;jobPosition=job;sourceFilename=filename;fileFormat=format;status=CandidateImportStatus.PREVIEWED;createdBy=user;createdAt=Instant.now();}
    public void counts(int total,int valid,int invalid,int duplicates){totalRows=total;validRows=valid;invalidRows=invalid;duplicateRows=duplicates;}
    public void complete(int imported){status=CandidateImportStatus.COMPLETED;importedRows=imported;completedAt=Instant.now();}
    public UUID getId(){return id;} public Company getCompany(){return company;} public JobPosition getJobPosition(){return jobPosition;} public String getSourceFilename(){return sourceFilename;} public String getFileFormat(){return fileFormat;} public CandidateImportStatus getStatus(){return status;} public int getTotalRows(){return totalRows;} public int getValidRows(){return validRows;} public int getInvalidRows(){return invalidRows;} public int getDuplicateRows(){return duplicateRows;} public int getImportedRows(){return importedRows;} public SystemUser getCreatedBy(){return createdBy;} public Instant getCreatedAt(){return createdAt;} public Instant getCompletedAt(){return completedAt;}
}
