package ai.xzkj.recruitment.autoreply;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import jakarta.persistence.*;
import java.time.*;
import java.util.UUID;

@Entity @Table(name = "auto_reply_policies")
public class AutoReplyPolicy {
    @Id private UUID id;
    @OneToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "boss_account_id") private BossAccount bossAccount;
    @Column(nullable = false) private boolean enabled;
    @Enumerated(EnumType.STRING) @Column(name = "away_mode", nullable = false, length = 24) private AwayMode awayMode;
    @Column(name = "away_started_at") private Instant awayStartedAt;
    @Column(name = "away_ends_at") private Instant awayEndsAt;
    @Column(name = "auto_send_enabled", nullable = false) private boolean autoSendEnabled;
    @Column(name = "response_timeout_minutes", nullable = false) private int responseTimeoutMinutes;
    @Column(name = "daily_limit", nullable = false) private int dailyLimit;
    @Column(name = "minimum_interval_seconds", nullable = false) private int minimumIntervalSeconds;
    @Column(name = "sending_window_start", nullable = false) private LocalTime sendingWindowStart;
    @Column(name = "sending_window_end", nullable = false) private LocalTime sendingWindowEnd;
    @Column(nullable = false, length = 64) private String timezone;
    @Column(name = "max_consecutive_failures", nullable = false) private int maxConsecutiveFailures;
    @Column(name = "consecutive_failures", nullable = false) private int consecutiveFailures;
    @Column(name = "paused_until") private Instant pausedUntil;
    @Column(name = "last_sent_at") private Instant lastSentAt;
    @Column(name = "sent_today", nullable = false) private int sentToday;
    @Column(name = "quota_date") private LocalDate quotaDate;
    @Column(name = "reply_template", nullable = false, columnDefinition = "TEXT") private String replyTemplate;
    @Version private long version;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "created_by") private SystemUser createdBy;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "updated_by") private SystemUser updatedBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected AutoReplyPolicy() {}
    public AutoReplyPolicy(BossAccount account, SystemUser user, String template) {
        id = UUID.randomUUID(); bossAccount = account; enabled = false; awayMode = AwayMode.IN_OFFICE; autoSendEnabled = false;
        responseTimeoutMinutes = 120; dailyLimit = 20; minimumIntervalSeconds = 180;
        sendingWindowStart = LocalTime.of(9, 0); sendingWindowEnd = LocalTime.of(21, 0);
        timezone = "Asia/Shanghai"; maxConsecutiveFailures = 3; replyTemplate = template;
        createdBy = user; updatedBy = user; createdAt = Instant.now(); updatedAt = createdAt;
    }
    public void update(boolean enabled, AwayMode awayMode, Instant awayEndsAt, boolean autoSendEnabled, int timeout, int dailyLimit, int interval,
                       LocalTime windowStart, LocalTime windowEnd, String timezone, int maxFailures,
                       String template, SystemUser user) {
        boolean starting = enabled && (!this.enabled || this.awayMode == AwayMode.IN_OFFICE);
        this.enabled = enabled; this.awayMode = enabled ? awayMode : AwayMode.IN_OFFICE;
        awayStartedAt = enabled ? (starting ? Instant.now() : awayStartedAt) : null;
        this.awayEndsAt = enabled ? awayEndsAt : null;
        this.autoSendEnabled = autoSendEnabled; responseTimeoutMinutes = timeout;
        this.dailyLimit = dailyLimit; minimumIntervalSeconds = interval; sendingWindowStart = windowStart;
        sendingWindowEnd = windowEnd; this.timezone = timezone; maxConsecutiveFailures = maxFailures;
        replyTemplate = template; updatedBy = user;
        if (!enabled) pausedUntil = null;
    }
    public void changeAwayMode(AwayMode mode, Instant endsAt, SystemUser user) {
        boolean active = mode != AwayMode.IN_OFFICE;
        enabled = active;
        awayMode = mode;
        awayStartedAt = active ? Instant.now() : null;
        awayEndsAt = active ? endsAt : null;
        updatedBy = user;
        if (!active) pausedUntil = null;
    }
    public void prepareQuota(LocalDate today) { if (!today.equals(quotaDate)) { quotaDate = today; sentToday = 0; } }
    public boolean isAwayActive(Instant now) { return enabled && awayMode != AwayMode.IN_OFFICE && (awayEndsAt == null || awayEndsAt.isAfter(now)); }
    public boolean canSend(Instant now) { return isAwayActive(now) && (pausedUntil == null || !pausedUntil.isAfter(now)); }
    public boolean intervalElapsed(Instant now) { return lastSentAt == null || !lastSentAt.plusSeconds(minimumIntervalSeconds).isAfter(now); }
    public void sent(Instant now) { sentToday++; lastSentAt = now; consecutiveFailures = 0; pausedUntil = null; }
    public void failed(Instant now) { consecutiveFailures++; if (consecutiveFailures >= maxConsecutiveFailures) pausedUntil = now.plus(Duration.ofHours(24)); }
    public UUID getId(){return id;} public BossAccount getBossAccount(){return bossAccount;} public boolean isEnabled(){return enabled;}
    public AwayMode getAwayMode(){return awayMode;} public Instant getAwayStartedAt(){return awayStartedAt;} public Instant getAwayEndsAt(){return awayEndsAt;}
    public boolean isAutoSendEnabled(){return autoSendEnabled;} public int getResponseTimeoutMinutes(){return responseTimeoutMinutes;}
    public int getDailyLimit(){return dailyLimit;} public int getMinimumIntervalSeconds(){return minimumIntervalSeconds;}
    public LocalTime getSendingWindowStart(){return sendingWindowStart;} public LocalTime getSendingWindowEnd(){return sendingWindowEnd;}
    public String getTimezone(){return timezone;} public int getMaxConsecutiveFailures(){return maxConsecutiveFailures;}
    public int getConsecutiveFailures(){return consecutiveFailures;} public Instant getPausedUntil(){return pausedUntil;}
    public Instant getLastSentAt(){return lastSentAt;} public int getSentToday(){return sentToday;} public LocalDate getQuotaDate(){return quotaDate;}
    public String getReplyTemplate(){return replyTemplate;} public long getVersion(){return version;} public Instant getCreatedAt(){return createdAt;}
    public Instant getUpdatedAt(){return updatedAt;}
    @PreUpdate void preUpdate(){updatedAt=Instant.now();}
}
