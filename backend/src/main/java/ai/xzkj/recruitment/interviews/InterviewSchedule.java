package ai.xzkj.recruitment.interviews;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="interview_schedules")
public class InterviewSchedule {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="contact_id") private CandidateJobContact contact;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="owner_hr_id") private SystemUser ownerHr;
    @Column(nullable=false,length=64) private String timezone;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=28) private InterviewStatus status;
    @Column(name="current_round",nullable=false) private int currentRound;
    @Enumerated(EnumType.STRING) @Column(name="mock_notification_outcome",nullable=false,length=16) private MockNotificationOutcome mockNotificationOutcome;
    @Column(name="confirmation_key",length=100) private String confirmationKey;
    @Enumerated(EnumType.STRING) @Column(name="last_confirmation_result",length=16) private InterviewConfirmationResult lastConfirmationResult;
    @ManyToOne(fetch=FetchType.LAZY) @JoinColumn(name="confirmed_slot_id") private InterviewSlot confirmedSlot;
    @Version private long version;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected InterviewSchedule() {}
    public InterviewSchedule(CandidateJobContact contact,SystemUser ownerHr,String timezone,MockNotificationOutcome outcome){
        id=UUID.randomUUID();this.contact=contact;this.ownerHr=ownerHr;this.timezone=timezone;status=InterviewStatus.PROPOSING;
        currentRound=1;mockNotificationOutcome=outcome;createdAt=Instant.now();updatedAt=createdAt;
    }
    public void confirm(InterviewSlot slot,String key){confirmedSlot=slot;confirmationKey=key;lastConfirmationResult=InterviewConfirmationResult.CONFIRMED;status=InterviewStatus.CONFIRMED;}
    public void requireReschedule(String key,InterviewConfirmationResult result){confirmationKey=key;lastConfirmationResult=result;confirmedSlot=null;status=InterviewStatus.RESCHEDULE_REQUIRED;}
    public void beginNextRound(){currentRound++;confirmationKey=null;lastConfirmationResult=null;confirmedSlot=null;status=InterviewStatus.RESCHEDULE_REQUIRED;}
    public void reopenProposal(){status=InterviewStatus.PROPOSING;}
    public void cancel(){status=InterviewStatus.CANCELLED;}
    public void updateMockOutcome(MockNotificationOutcome outcome){mockNotificationOutcome=outcome;}
    @PreUpdate void preUpdate(){updatedAt=Instant.now();}
    public UUID getId(){return id;} public CandidateJobContact getContact(){return contact;} public SystemUser getOwnerHr(){return ownerHr;}
    public String getTimezone(){return timezone;} public InterviewStatus getStatus(){return status;} public int getCurrentRound(){return currentRound;}
    public MockNotificationOutcome getMockNotificationOutcome(){return mockNotificationOutcome;} public String getConfirmationKey(){return confirmationKey;}
    public InterviewConfirmationResult getLastConfirmationResult(){return lastConfirmationResult;}
    public InterviewSlot getConfirmedSlot(){return confirmedSlot;} public long getVersion(){return version;}
    public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;}
}
