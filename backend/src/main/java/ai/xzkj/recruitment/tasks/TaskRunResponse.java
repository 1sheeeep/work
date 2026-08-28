package ai.xzkj.recruitment.tasks;

public record TaskRunResponse(RecruitmentTaskResponse task, TaskExecutionResponse execution, boolean replayed) {
}
