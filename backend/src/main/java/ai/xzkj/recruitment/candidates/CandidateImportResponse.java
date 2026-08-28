package ai.xzkj.recruitment.candidates;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
public record CandidateImportResponse(UUID id,UUID companyId,UUID jobPositionId,String jobTitle,String sourceFilename,String fileFormat,CandidateImportStatus status,int totalRows,int validRows,int invalidRows,int duplicateRows,int importedRows,String createdBy,Instant createdAt,Instant completedAt,List<Row> rows){
 public static CandidateImportResponse from(CandidateImportBatch batch,List<CandidateImportRow> rows){return new CandidateImportResponse(batch.getId(),batch.getCompany().getId(),batch.getJobPosition().getId(),batch.getJobPosition().getTitle(),batch.getSourceFilename(),batch.getFileFormat(),batch.getStatus(),batch.getTotalRows(),batch.getValidRows(),batch.getInvalidRows(),batch.getDuplicateRows(),batch.getImportedRows(),batch.getCreatedBy().getDisplayName(),batch.getCreatedAt(),batch.getCompletedAt(),rows.stream().map(Row::from).toList());}
 public record Row(int rowNumber,String displayName,String currentTitle,Integer yearsExperience,String education,String skillsSummary,CandidateImportRowStatus status,String validationMessage,UUID importedContactId){static Row from(CandidateImportRow row){return new Row(row.getRowNumber(),row.getDisplayName(),row.getCurrentTitle(),row.getYearsExperience(),row.getEducation(),row.getSkillsSummary(),row.getStatus(),row.getValidationMessage(),row.getImportedContactId());}}
}
