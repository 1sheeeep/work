package ai.xzkj.recruitment.notifications;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="notification_attempts")
public class NotificationAttempt {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="notification_id") private HrNotification notification;
    @Column(name="idempotency_key",nullable=false,length=100) private String idempotencyKey;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=16) private NotificationStatus status;
    @Column(length=1000) private String message;
    @Column(name="attempted_at",nullable=false) private Instant attemptedAt;
    protected NotificationAttempt() {}
    public NotificationAttempt(HrNotification notification,String key,boolean succeeded,String message){
        id=UUID.randomUUID();this.notification=notification;idempotencyKey=key;status=succeeded?NotificationStatus.SENT:NotificationStatus.FAILED;
        this.message=message;attemptedAt=Instant.now();
    }
    public UUID getId(){return id;} public String getIdempotencyKey(){return idempotencyKey;} public NotificationStatus getStatus(){return status;}
    public String getMessage(){return message;} public Instant getAttemptedAt(){return attemptedAt;}
}
