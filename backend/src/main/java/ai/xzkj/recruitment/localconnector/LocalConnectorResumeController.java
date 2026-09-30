package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.resumes.AiAssistanceRun;
import ai.xzkj.recruitment.resumes.AiAssistanceRunRepository;
import ai.xzkj.recruitment.resumes.ResumeDocumentPipelineService;
import ai.xzkj.recruitment.resumes.ResumeDocumentProcessingResponse;
import ai.xzkj.recruitment.resumes.ResumeIntake;
import ai.xzkj.recruitment.resumes.ResumeIntakeRepository;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@RestController
class LocalConnectorResumeController {
    private final LocalConnectorService connectors;
    private final BrowserUnreadObservationRepository observations;
    private final JobPositionRepository jobs;
    private final LocalConnectorActionTaskRepository tasks;
    private final ResumeDocumentPipelineService pipeline;
    private final ResumeIntakeRepository resumeIntakes;
    private final AiAssistanceRunRepository analysisRuns;
    private final ObjectMapper mapper;

    LocalConnectorResumeController(LocalConnectorService connectors, BrowserUnreadObservationRepository observations,
                                   JobPositionRepository jobs, LocalConnectorActionTaskRepository tasks,
                                   ResumeDocumentPipelineService pipeline, ResumeIntakeRepository resumeIntakes,
                                   AiAssistanceRunRepository analysisRuns, ObjectMapper mapper) {
        this.connectors = connectors;
        this.observations = observations;
        this.jobs = jobs;
        this.tasks = tasks;
        this.pipeline = pipeline;
        this.resumeIntakes = resumeIntakes;
        this.analysisRuns = analysisRuns;
        this.mapper = mapper;
    }

    @GetMapping("/api/local-connector/runtime/current-resume-analysis")
    @Transactional(readOnly = true)
    CurrentResumeAnalysisResponse currentResumeAnalysis(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                         @RequestParam String chatDigest) {
        if (chatDigest == null || !chatDigest.matches("[a-f0-9]{64}"))
            throw new ApiException(HttpStatus.BAD_REQUEST, "CHAT_DIGEST_INVALID", "当前会话标识无效");
        BrowserDevice device = connectors.authenticate(authorization);
        BrowserUnreadObservation observation = observations
                .findWithAccountAndDeviceByAccountIdAndChatDigest(device.getBossAccount().getId(), chatDigest)
                .orElse(null);
        if (observation == null || observation.getDevice() == null
                || !device.getId().equals(observation.getDevice().getId())) {
            return CurrentResumeAnalysisResponse.empty("NOT_FOUND", "NOT_FOUND", "当前会话尚未关联简历记录。", Instant.now());
        }
        Instant updatedAt = observation.getResumePipelineUpdatedAt();
        UUID intakeId = observation.getResumeIntakeId();
        if (intakeId == null) {
            return CurrentResumeAnalysisResponse.empty(
                    observation.getResumePipelineStatus(), "NOT_REQUESTED",
                    observation.getResumePipelineReason(), updatedAt);
        }
        ResumeIntake intake = resumeIntakes.findWithDetailsById(intakeId).orElse(null);
        if (intake == null || intake.getContact() == null || intake.getContact().getBossAccount() == null
                || intake.getContact().getCandidate() == null || intake.getContact().getCandidate().getCompany() == null
                || device.getBossAccount().getCompany() == null
                || !device.getBossAccount().getId().equals(intake.getContact().getBossAccount().getId())
                || !device.getBossAccount().getCompany().getId().equals(intake.getContact().getCandidate().getCompany().getId())) {
            return CurrentResumeAnalysisResponse.empty("NOT_FOUND", "NOT_FOUND", "当前会话尚未关联简历记录。", updatedAt);
        }

        String candidateName = intake.getContact().getCandidate().getDisplayName();
        AiAssistanceRun latest = analysisRuns.findFirstByResumeIntakeIdOrderByCreatedAtDesc(intakeId).orElse(null);
        String analysisStatus = intake.getAnalysisStatus();
        String failureReason = intake.getAnalysisFailureReason();
        if (latest == null) {
            return new CurrentResumeAnalysisResponse(true, candidateName, intake.getProcessingStatus(), analysisStatus,
                    null, null, List.of(), cleanReason(failureReason != null ? failureReason : observation.getResumePipelineReason()), updatedAt);
        }
        if (latest.isResultPurged() || (latest.getResultExpiresAt() != null && !latest.getResultExpiresAt().isAfter(Instant.now()))) {
            return new CurrentResumeAnalysisResponse(true, candidateName, intake.getProcessingStatus(), "RESULT_EXPIRED",
                    null, null, List.of(), "分析结果已过期，请在简历分析页面重新查看。", latest.getCreatedAt());
        }
        if (!"SUCCEEDED".equals(latest.getStatus()) || latest.getStructuredResult() == null) {
            return new CurrentResumeAnalysisResponse(true, candidateName, intake.getProcessingStatus(), latest.getStatus(),
                    null, null, List.of(), cleanReason(latest.getErrorMessage()), latest.getCreatedAt());
        }

        try {
            JsonNode result = mapper.readTree(latest.getStructuredResult());
            String recommendation = bounded(result.path("recommendation").asText(""), 40);
            String summary = bounded(result.path("summary").asText(""), 800);
            List<String> evidence = new ArrayList<>();
            JsonNode evidenceNodes = result.path("evidence");
            if (evidenceNodes.isArray()) for (JsonNode item : evidenceNodes) {
                String criterion = bounded(item.path("criterion").asText(""), 100);
                String finding = bounded(item.path("finding").asText(""), 220);
                String combined = criterion.isBlank() ? finding : criterion + "：" + finding;
                if (!combined.isBlank()) evidence.add(combined);
                if (evidence.size() >= 3) break;
            }
            return new CurrentResumeAnalysisResponse(true, candidateName, intake.getProcessingStatus(), "SUCCEEDED",
                    recommendation.isBlank() ? null : recommendation, summary.isBlank() ? null : summary,
                    List.copyOf(evidence), null, latest.getCreatedAt());
        } catch (RuntimeException exception) {
            return new CurrentResumeAnalysisResponse(true, candidateName, intake.getProcessingStatus(), "RESULT_UNAVAILABLE",
                    null, null, List.of(), "分析结果暂时无法读取，请到简历分析页面复核。", latest.getCreatedAt());
        }
    }

    private String cleanReason(String value) { return bounded(value == null ? "" : value.replace('\n', ' ').replace('\r', ' '), 240); }
    private String bounded(String value, int max) {
        String clean = value == null ? "" : value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() <= max ? clean : clean.substring(0, max);
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
