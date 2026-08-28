package ai.xzkj.recruitment.notifications;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.interviews.InterviewSchedule;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="hr_notifications")
public class HrNotification {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="schedule_id") private InterviewSchedule schedule;
    @Column(name="confirmation_round",nullable=false) private int confirmationRound;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="recipient_id") private SystemUser recipient;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) private NotificationChannel channel;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private NotificationStatus status;
    @Column(name="attempt_count",nullable=false) private int attemptCount;
    @Column(name="last_error",length=1000) private String lastError;
    @Column(name="sent_at") private Instant sentAt;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    protected HrNotification() {}
    public HrNotification(InterviewSchedule schedule,int round,SystemUser recipient){
        id=UUID.randomUUID();this.schedule=schedule;confirmationRound=round;this.recipient=recipient;channel=NotificationChannel.IN_APP_MOCK;
        status=NotificationStatus.PENDING;createdAt=Instant.now();updatedAt=createdAt;
    }
    public void apply(boolean succeeded,String message){attemptCount++;if(succeeded){status=NotificationStatus.SENT;sentAt=Instant.now();lastError=null;}else{status=NotificationStatus.FAILED;lastError=message;}}
    @PreUpdate void preUpdate(){updatedAt=Instant.now();}
    public UUID getId(){return id;} public InterviewSchedule getSchedule(){return schedule;} public int getConfirmationRound(){return confirmationRound;}
    public SystemUser getRecipient(){return recipient;} public NotificationChannel getChannel(){return channel;} public NotificationStatus getStatus(){return status;}
    public int getAttemptCount(){return attemptCount;} public String getLastError(){return lastError;} public Instant getSentAt(){return sentAt;}
    public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;}
}
