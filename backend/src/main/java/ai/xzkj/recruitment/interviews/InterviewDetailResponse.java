package ai.xzkj.recruitment.interviews;
import ai.xzkj.recruitment.notifications.HrNotificationResponse;
import java.util.List;
public record InterviewDetailResponse(InterviewScheduleResponse schedule,List<InterviewSlotResponse> slots,List<HrNotificationResponse> notifications){}
