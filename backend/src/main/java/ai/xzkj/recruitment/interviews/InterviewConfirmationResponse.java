package ai.xzkj.recruitment.interviews;
import ai.xzkj.recruitment.notifications.HrNotificationResponse;
public record InterviewConfirmationResponse(InterviewScheduleResponse schedule,InterviewConfirmationResult result,
                                            HrNotificationResponse notification,boolean replayed){}
