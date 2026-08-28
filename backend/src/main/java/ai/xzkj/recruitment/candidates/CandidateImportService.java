package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.*;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class CandidateImportService {
    private static final long MAX_FILE_SIZE=5L*1024*1024;
    private final CandidateImportParser parser;private final CandidateImportBatchRepository batches;private final CandidateImportRowRepository rows;private final CandidateProfileRepository profiles;private final CandidateJobContactRepository contacts;private final ScreeningDecisionRepository decisions;private final JobPositionRepository jobs;private final CurrentUserService users;private final AuditService audit;
    public CandidateImportService(CandidateImportParser parser,CandidateImportBatchRepository batches,CandidateImportRowRepository rows,CandidateProfileRepository profiles,CandidateJobContactRepository contacts,ScreeningDecisionRepository decisions,JobPositionRepository jobs,CurrentUserService users,AuditService audit){this.parser=parser;this.batches=batches;this.rows=rows;this.profiles=profiles;this.contacts=contacts;this.decisions=decisions;this.jobs=jobs;this.users=users;this.audit=audit;}

    @Transactional
    public CandidateImportResponse preview(UUID jobId,MultipartFile file){SystemUser user=users.requireCurrentUser();JobPosition job=requireJob(jobId,user);if(file==null||file.isEmpty())throw bad("IMPORT_FILE_EMPTY","请选择导入文件");if(file.getSize()>MAX_FILE_SIZE)throw bad("IMPORT_FILE_TOO_LARGE","导入文件不能超过 5 MB");var parsed=parser.parse(file);String filename=cleanFilename(file.getOriginalFilename());CandidateImportBatch batch=batches.save(new CandidateImportBatch(job.getCompany(),job,filename,parsed.format(),user));Set<String> seen=new HashSet<>();List<CandidateImportRow> saved=new ArrayList<>();int valid=0,invalid=0,duplicates=0;
        for(var input:parsed.rows()){String external=input.value("externalCandidateId"),name=clean(input.value("displayName"),100),title=clean(input.value("currentTitle"),120),education=clean(input.value("education"),80),skills=clean(input.value("skillsSummary"),3000);Integer years=parseYears(input.value("yearsExperience"));String key=hash(job.getCompany().getId()+"|IMPORT|"+external.toLowerCase(Locale.ROOT));CandidateImportRowStatus status=CandidateImportRowStatus.VALID;String message=null;
            if(external.isBlank()||name==null){status=CandidateImportRowStatus.INVALID;message="外部候选人 ID 和姓名为必填项";}else if(formula(external,name,title,education,skills)){status=CandidateImportRowStatus.INVALID;message="不允许使用公式单元格";}else if(years!=null&&(years<0||years>60)){status=CandidateImportRowStatus.INVALID;message="工作年限必须在 0–60 之间";}else if(!seen.add(key)){status=CandidateImportRowStatus.DUPLICATE_FILE;message="文件内外部候选人 ID 重复";}else{var profile=profiles.findByCompanyIdAndSourceAndDedupKey(job.getCompany().getId(),CandidateSource.IMPORT,key);if(profile.isPresent()&&contacts.findByCandidateIdAndJobPositionId(profile.get().getId(),job.getId()).isPresent()){status=CandidateImportRowStatus.DUPLICATE_EXISTING;message="该候选人已存在于当前职位";}}
            if(status==CandidateImportRowStatus.VALID)valid++;else if(status==CandidateImportRowStatus.INVALID)invalid++;else duplicates++;saved.add(new CandidateImportRow(batch,input.rowNumber(),key,name,title,years,education,skills,status,message));}
        rows.saveAll(saved);batch.counts(saved.size(),valid,invalid,duplicates);audit.success("PREVIEW_CANDIDATE_IMPORT","CANDIDATE_IMPORT",batch.getId(),filename,"解析 "+saved.size()+" 行，可导入 "+valid+" 行，不记录原始外部 ID");return CandidateImportResponse.from(batch,saved);}

    @Transactional
    public CandidateImportResponse confirm(UUID id){SystemUser user=users.requireCurrentUser();CandidateImportBatch batch=requireBatch(id,user);List<CandidateImportRow> importRows=rows.findByBatchIdOrderByRowNumber(id);if(batch.getStatus()==CandidateImportStatus.COMPLETED)return CandidateImportResponse.from(batch,importRows);int imported=0;for(CandidateImportRow row:importRows){if(row.getStatus()!=CandidateImportRowStatus.VALID){row.purge();continue;}CandidateProfile profile=profiles.findByCompanyIdAndSourceAndDedupKey(batch.getCompany().getId(),CandidateSource.IMPORT,row.getDedupKey()).orElseGet(()->profiles.save(new CandidateProfile(batch.getCompany(),CandidateSource.IMPORT,row.getDedupKey(),row.getDisplayName(),row.getCurrentTitle(),row.getYearsExperience(),row.getEducation(),row.getSkillsSummary())));var existing=contacts.findByCandidateIdAndJobPositionId(profile.getId(),batch.getJobPosition().getId());CandidateJobContact contact;if(existing.isPresent())contact=existing.get();else{profile.refresh(row.getDisplayName(),row.getCurrentTitle(),row.getYearsExperience(),row.getEducation(),row.getSkillsSummary());contact=contacts.save(new CandidateJobContact(profile,batch.getJobPosition(),batch.getJobPosition().getBossAccount()));decisions.save(new ScreeningDecision(contact,ScreeningDecisionType.HARD_RULE,ScreeningOutcome.REVIEW,"import-validation-v1",null,null,"批量导入完成，等待硬规则评估",user));decisions.save(new ScreeningDecision(contact,ScreeningDecisionType.AI_SUGGESTION,ScreeningOutcome.REVIEW,null,"pending","candidate-screening-v1","等待 AI 辅助筛选",user));contact.applyScreening(ScreeningOutcome.REVIEW,ScreeningOutcome.REVIEW);imported++;}row.imported(contact.getId());}batch.complete(imported);audit.success("CONFIRM_CANDIDATE_IMPORT","CANDIDATE_IMPORT",batch.getId(),batch.getSourceFilename(),"确认导入 "+imported+" 个候选人职位关系，预览个人字段已清理");return CandidateImportResponse.from(batch,importRows);}

    @Transactional(readOnly=true) public List<CandidateImportResponse> list(){SystemUser user=users.requireCurrentUser();return batches.findTop20ByOrderByCreatedAtDesc().stream().filter(b->canAccess(b.getCompany().getId(),user)).map(b->CandidateImportResponse.from(b,List.of())).toList();}
    @Transactional(readOnly=true) public CandidateImportResponse detail(UUID id){SystemUser user=users.requireCurrentUser();CandidateImportBatch batch=requireBatch(id,user);return CandidateImportResponse.from(batch,rows.findByBatchIdOrderByRowNumber(id));}
    private CandidateImportBatch requireBatch(UUID id,SystemUser user){CandidateImportBatch batch=batches.findWithDetailsById(id).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"CANDIDATE_IMPORT_NOT_FOUND","导入批次不存在"));if(!canAccess(batch.getCompany().getId(),user))throw forbidden();return batch;}
    private JobPosition requireJob(UUID id,SystemUser user){JobPosition job=jobs.findWithDetailsById(id).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"JOB_POSITION_NOT_FOUND","职位不存在"));if(!canAccess(job.getCompany().getId(),user))throw forbidden();if(job.getStatus()!=JobPositionStatus.ACTIVE)throw bad("JOB_POSITION_NOT_ACTIVE","只能向已启用职位导入候选人");return job;}
    private boolean canAccess(UUID companyId,SystemUser user){return user.getRole()==UserRole.SYSTEM_ADMIN||user.getCompanyScopes().stream().map(Company::getId).collect(Collectors.toSet()).contains(companyId);}
    private ApiException forbidden(){return new ApiException(HttpStatus.FORBIDDEN,"COMPANY_SCOPE_FORBIDDEN","当前账号无权访问该企业数据");}private ApiException bad(String code,String message){return new ApiException(HttpStatus.BAD_REQUEST,code,message);}
    private String cleanFilename(String value){String name=value==null?"candidates.csv":value.replace('\\','/');name=name.substring(name.lastIndexOf('/')+1).trim();return name.isBlank()?"candidates.csv":name.substring(0,Math.min(255,name.length()));}
    private String clean(String value,int max){if(value==null||value.isBlank())return null;String clean=value.trim();return clean.length()<=max?clean:clean.substring(0,max);}
    private Integer parseYears(String value){if(value==null||value.isBlank())return null;try{return Integer.valueOf(value.replaceFirst("\\.0$", ""));}catch(NumberFormatException e){return -1;}}
    private boolean formula(String... values){return Arrays.stream(values).filter(Objects::nonNull).anyMatch(v->v.startsWith("=")||v.startsWith("+")||v.startsWith("@"));}
    private String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
}
