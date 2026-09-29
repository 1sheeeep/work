package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.resumes.ResumeDocumentPipelineService;
import ai.xzkj.recruitment.resumes.ResumeDocumentProcessingResponse;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;
import java.time.Instant;

@RestController
class LocalConnectorResumeController {
    private final LocalConnectorService connectors;
    private final BrowserUnreadObservationRepository observations;
    private final JobPositionRepository jobs;
    private final LocalConnectorActionTaskRepository tasks;
    private final ResumeDocumentPipelineService pipeline;

    LocalConnectorResumeController(LocalConnectorService connectors, BrowserUnreadObservationRepository observations,
                                   JobPositionRepository jobs, LocalConnectorActionTaskRepository tasks,
                                   ResumeDocumentPipelineService pipeline) {
        this.connectors = connectors;
        this.observations = observations;
        this.jobs = jobs;
        this.tasks = tasks;
        this.pipeline = pipeline;
    }

    @PostMapping(value="/api/local-connector/runtime/resume-documents", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    ResumeDocumentProcessingResponse receive(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                              @RequestParam UUID observationId,
                                              @RequestParam String sourceEventDigest,
                                              @RequestParam(required=false) UUID sourceActionTaskId,
                                              @RequestPart("file") MultipartFile file) {
        BrowserDevice device = connectors.authenticate(authorization);
        BrowserUnreadObservation observation = observations.findWithAccountById(observationId)
                .orElseThrow(() -> bad("OBSERVATION_NOT_FOUND", "简历对应的会话观测不存在"));
        if (!observation.getDevice().getId().equals(device.getId())
                || !observation.getAccount().getId().equals(device.getBossAccount().getId()))
            throw new ApiException(HttpStatus.FORBIDDEN, "RESUME_OBSERVATION_DEVICE_MISMATCH", "简历事件不属于当前账号和浏览器设备");
        if (observation.getMatchedJobPositionId() == null)
            throw bad("RESUME_JOB_MATCH_REQUIRED", "会话尚未唯一匹配真实岗位，简历已停止入库");
        JobPosition job = jobs.findWithDetailsById(observation.getMatchedJobPositionId())
                .orElseThrow(() -> bad("RESUME_JOB_NOT_FOUND", "会话匹配的真实岗位不存在"));
        if (!job.getBossAccount().getId().equals(device.getBossAccount().getId()))
            throw new ApiException(HttpStatus.FORBIDDEN, "RESUME_JOB_ACCOUNT_MISMATCH", "简历岗位与当前 BOSS 账号不一致");
        if (sourceEventDigest == null || !sourceEventDigest.matches("[a-f0-9]{64}"))
            throw bad("RESUME_EVENT_DIGEST_INVALID", "简历页面事件摘要无效，已停止入库");
        if (sourceActionTaskId != null) {
            LocalConnectorActionTask task = tasks.findWithObservationById(sourceActionTaskId)
                    .orElseThrow(() -> bad("RESUME_REQUEST_TASK_NOT_FOUND", "关联的索要简历任务不存在"));
            if (!"REQUEST_RESUME".equals(task.getActionType()) || !"SUCCEEDED".equals(task.getStatus())
                    || task.getObservation() == null || !task.getObservation().getId().equals(observation.getId())
                    || !task.getAccount().getId().equals(device.getBossAccount().getId()))
                throw bad("RESUME_REQUEST_TASK_MISMATCH", "简历事件与已成功的本轮索要简历任务不一致");
        }
        observation.markResumeImporting(Instant.now());
        observations.saveAndFlush(observation);
        try {
            ResumeDocumentProcessingResponse result = pipeline.processVisibleResume(
                    job, observation.getChatDigest(), sourceEventDigest, sourceActionTaskId, file);
            String failureReason = result.analysisFailureReason() != null
                    ? result.analysisFailureReason() : result.failureReason();
            observation.recordResumePipelineResult(result.intakeId(), result.processingStatus(), result.analysisStatus(), failureReason, Instant.now());
            observations.saveAndFlush(observation);
            return result;
        } catch (RuntimeException exception) {
            observation.markResumePipelineFailed(exception.getMessage(), Instant.now());
            observations.saveAndFlush(observation);
            throw exception;
        }
    }

    @PostMapping(value="/api/local-connector/runtime/visible-resume-text", consumes=MediaType.APPLICATION_JSON_VALUE)
    ResumeDocumentProcessingResponse receiveVisibleText(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                         @RequestBody @jakarta.validation.Valid VisibleResumeTextRequest request) {
        BrowserDevice device = connectors.authenticate(authorization);
        BrowserUnreadObservation observation = observations.findWithAccountById(request.observationId())
                .orElseThrow(() -> bad("OBSERVATION_NOT_FOUND", "简历对应的会话观测不存在"));
        if (!observation.getDevice().getId().equals(device.getId())
                || !observation.getAccount().getId().equals(device.getBossAccount().getId()))
            throw new ApiException(HttpStatus.FORBIDDEN, "RESUME_OBSERVATION_DEVICE_MISMATCH", "简历事件不属于当前账号和浏览器设备");
        if (!observation.getConversationSignals().resumeReceived())
            throw bad("VISIBLE_RESUME_NOT_CONFIRMED", "当前会话尚未稳定识别到真实在线简历");
        if (observation.getMatchedJobPositionId() == null)
            throw bad("RESUME_JOB_MATCH_REQUIRED", "会话尚未唯一匹配真实岗位，简历已停止入库");
        JobPosition job = jobs.findWithDetailsById(observation.getMatchedJobPositionId())
                .orElseThrow(() -> bad("RESUME_JOB_NOT_FOUND", "会话匹配的真实岗位不存在"));
        if (!job.getBossAccount().getId().equals(device.getBossAccount().getId()))
            throw new ApiException(HttpStatus.FORBIDDEN, "RESUME_JOB_ACCOUNT_MISMATCH", "简历岗位与当前 BOSS 账号不一致");
        observation.markResumeImporting(Instant.now());
        observations.saveAndFlush(observation);
        try {
            ResumeDocumentProcessingResponse result = pipeline.processVisibleResumeText(
                    job, observation.getChatDigest(), request.sourceEventDigest(), request.resumeText());
            String failureReason = result.analysisFailureReason() != null
                    ? result.analysisFailureReason() : result.failureReason();
            observation.recordResumePipelineResult(result.intakeId(), result.processingStatus(), result.analysisStatus(), failureReason, Instant.now());
            observations.saveAndFlush(observation);
            return result;
        } catch (RuntimeException exception) {
            observation.markResumePipelineFailed(exception.getMessage(), Instant.now());
            observations.saveAndFlush(observation);
            throw exception;
        }
    }

    private ApiException bad(String code,String message){return new ApiException(HttpStatus.CONFLICT,code,message);}
}
