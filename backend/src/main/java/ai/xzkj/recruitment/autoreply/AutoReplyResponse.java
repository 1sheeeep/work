package ai.xzkj.recruitment.autoreply;

import java.time.*;
import java.util.UUID;

public record AutoReplyResponse(UUID accountId,String accountName,UUID companyId,String companyName,String accountStatus,String connectionStatus,
        boolean messageSendCapable,boolean configured,boolean enabled,AwayMode awayMode,Instant awayStartedAt,Instant awayEndsAt,boolean awayActive,boolean autoSendEnabled,int responseTimeoutMinutes,int dailyLimit,
        int minimumIntervalSeconds,LocalTime sendingWindowStart,LocalTime sendingWindowEnd,String timezone,int maxConsecutiveFailures,
        int consecutiveFailures,Instant pausedUntil,Instant lastSentAt,int sentToday,LocalDate quotaDate,String replyTemplate,long version) {
    static AutoReplyResponse unconfigured(ai.xzkj.recruitment.boss.BossAccount a,String template){return new AutoReplyResponse(a.getId(),a.getDisplayName(),a.getCompany().getId(),a.getCompany().getName(),a.getStatus().name(),a.getConnectionStatus().name(),a.getCapabilities().contains(ai.xzkj.recruitment.boss.BossCapability.MESSAGE_SEND),false,false,AwayMode.IN_OFFICE,null,null,false,false,120,20,180,LocalTime.of(9,0),LocalTime.of(21,0),"Asia/Shanghai",3,0,null,null,0,null,template,0);}
    static AutoReplyResponse from(AutoReplyPolicy p){var a=p.getBossAccount();Instant now=Instant.now();return new AutoReplyResponse(a.getId(),a.getDisplayName(),a.getCompany().getId(),a.getCompany().getName(),a.getStatus().name(),a.getConnectionStatus().name(),a.getCapabilities().contains(ai.xzkj.recruitment.boss.BossCapability.MESSAGE_SEND),true,p.isEnabled(),p.getAwayMode(),p.getAwayStartedAt(),p.getAwayEndsAt(),p.isAwayActive(now),p.isAutoSendEnabled(),p.getResponseTimeoutMinutes(),p.getDailyLimit(),p.getMinimumIntervalSeconds(),p.getSendingWindowStart(),p.getSendingWindowEnd(),p.getTimezone(),p.getMaxConsecutiveFailures(),p.getConsecutiveFailures(),p.getPausedUntil(),p.getLastSentAt(),p.getSentToday(),p.getQuotaDate(),p.getReplyTemplate(),p.getVersion());}
}
