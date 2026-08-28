package ai.xzkj.recruitment.interviews;

import ai.xzkj.recruitment.candidates.CandidateJobContact;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record InterviewScheduleResponse(UUID id,ContactSummary contact,OwnerSummary ownerHr,String timezone,
                                        InterviewStatus status,int currentRound,MockNotificationOutcome mockNotificationOutcome,
                                        InterviewSlotResponse confirmedSlot,List<InterviewSlotResponse> currentSlots,
                                        long version,Instant createdAt,Instant updatedAt){
    public static InterviewScheduleResponse from(InterviewSchedule schedule,List<InterviewSlot> currentSlots){
        CandidateJobContact c=schedule.getContact();return new InterviewScheduleResponse(schedule.getId(),
                new ContactSummary(c.getId(),c.getCandidate().getDisplayName(),c.getCandidate().getPrivacyStatus().name(),
                        c.getCandidate().getCompany().getId(),c.getCandidate().getCompany().getName(),c.getJobPosition().getId(),c.getJobPosition().getTitle()),
                new OwnerSummary(schedule.getOwnerHr().getId(),schedule.getOwnerHr().getDisplayName()),schedule.getTimezone(),schedule.getStatus(),
                schedule.getCurrentRound(),schedule.getMockNotificationOutcome(),schedule.getConfirmedSlot()==null?null:InterviewSlotResponse.from(schedule.getConfirmedSlot()),
                currentSlots.stream().map(InterviewSlotResponse::from).toList(),schedule.getVersion(),schedule.getCreatedAt(),schedule.getUpdatedAt());
    }
    public record ContactSummary(UUID id,String candidateName,String privacyStatus,UUID companyId,String companyName,UUID jobPositionId,String jobTitle){}
    public record OwnerSummary(UUID id,String displayName){}
}
