package ai.xzkj.recruitment.candidates;

import jakarta.persistence.*;
import java.util.UUID;

@Entity @Table(name="candidate_import_rows")
public class CandidateImportRow {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="batch_id") private CandidateImportBatch batch;
    @Column(name="row_number",nullable=false) private int rowNumber;
    @Column(name="dedup_key",nullable=false,length=64) private String dedupKey;
    @Column(name="display_name",length=100) private String displayName;
    @Column(name="current_title",length=120) private String currentTitle;
    @Column(name="years_experience") private Integer yearsExperience;
    @Column(length=80) private String education;
    @Column(name="skills_summary",columnDefinition="TEXT") private String skillsSummary;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=24) private CandidateImportRowStatus status;
    @Column(name="validation_message",length=500) private String validationMessage;
    @Column(name="imported_contact_id") private UUID importedContactId;
    protected CandidateImportRow(){}
    public CandidateImportRow(CandidateImportBatch batch,int row,String key,String name,String title,Integer years,String education,String skills,CandidateImportRowStatus status,String message){id=UUID.randomUUID();this.batch=batch;rowNumber=row;dedupKey=key;displayName=name;currentTitle=title;yearsExperience=years;this.education=education;skillsSummary=skills;this.status=status;validationMessage=message;}
    public void imported(UUID contactId){status=CandidateImportRowStatus.IMPORTED;importedContactId=contactId;validationMessage=null;displayName=null;currentTitle=null;yearsExperience=null;education=null;skillsSummary=null;}
    public void purge(){displayName=null;currentTitle=null;yearsExperience=null;education=null;skillsSummary=null;}
    public UUID getId(){return id;} public int getRowNumber(){return rowNumber;} public String getDedupKey(){return dedupKey;} public String getDisplayName(){return displayName;} public String getCurrentTitle(){return currentTitle;} public Integer getYearsExperience(){return yearsExperience;} public String getEducation(){return education;} public String getSkillsSummary(){return skillsSummary;} public CandidateImportRowStatus getStatus(){return status;} public String getValidationMessage(){return validationMessage;} public UUID getImportedContactId(){return importedContactId;}
}
