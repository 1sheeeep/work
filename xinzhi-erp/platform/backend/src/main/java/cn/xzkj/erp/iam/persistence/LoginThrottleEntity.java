package cn.xzkj.erp.iam.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "iam_login_throttles")
public class LoginThrottleEntity {

    @EmbeddedId
    private LoginThrottleId id;

    @Column(name = "failed_count", nullable = false)
    private int failedCount;

    @Column(name = "window_started_at", nullable = false)
    private Instant windowStartedAt;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected LoginThrottleEntity() {
    }
}
