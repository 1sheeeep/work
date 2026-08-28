package ai.xzkj.recruitment.interviews;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="interview_slots")
public class InterviewSlot {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="schedule_id") private InterviewSchedule schedule;
    @Column(name="round_number",nullable=false) private int roundNumber;
    @Column(name="starts_at",nullable=false) private Instant startsAt;
    @Column(name="ends_at",nullable=false) private Instant endsAt;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private InterviewSlotStatus status;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    protected InterviewSlot() {}
    public InterviewSlot(InterviewSchedule schedule,int roundNumber,Instant startsAt,Instant endsAt){
        id=UUID.randomUUID();this.schedule=schedule;this.roundNumber=roundNumber;this.startsAt=startsAt;this.endsAt=endsAt;
        status=InterviewSlotStatus.AVAILABLE;createdAt=Instant.now();
    }
    public void confirm(){status=InterviewSlotStatus.CONFIRMED;} public void decline(){status=InterviewSlotStatus.DECLINED;}
    public void expire(){status=InterviewSlotStatus.EXPIRED;}
    public UUID getId(){return id;} public InterviewSchedule getSchedule(){return schedule;} public int getRoundNumber(){return roundNumber;}
    public Instant getStartsAt(){return startsAt;} public Instant getEndsAt(){return endsAt;} public InterviewSlotStatus getStatus(){return status;}
    public Instant getCreatedAt(){return createdAt;}
}
