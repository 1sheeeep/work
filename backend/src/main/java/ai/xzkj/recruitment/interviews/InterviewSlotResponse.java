package ai.xzkj.recruitment.interviews;
import java.time.Instant;
import java.util.UUID;
public record InterviewSlotResponse(UUID id,int roundNumber,Instant startsAt,Instant endsAt,InterviewSlotStatus status){
    public static InterviewSlotResponse from(InterviewSlot slot){return new InterviewSlotResponse(slot.getId(),slot.getRoundNumber(),slot.getStartsAt(),slot.getEndsAt(),slot.getStatus());}
}
