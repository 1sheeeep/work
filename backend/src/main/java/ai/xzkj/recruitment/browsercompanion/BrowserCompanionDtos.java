package ai.xzkj.recruitment.browsercompanion;
import jakarta.validation.Valid;import jakarta.validation.constraints.*;import java.time.Instant;import java.util.*;
record CreatePairingRequest(@NotNull UUID accountId){}
record PairDeviceRequest(@NotBlank @Size(max=200)String pairingToken,@NotBlank @Size(max=100)String deviceName){}
record HeartbeatRequest(@NotBlank @Pattern(regexp="DISABLED|RUNNING|PAUSED|OFFLINE")String state,@Size(max=300)String reason){}
record BindConversationRequest(@NotNull UUID contactId,@NotBlank @Size(max=500)String externalChatId,@Size(max=120)String displayHint){}
record SyncMessageRequest(@NotBlank @Size(max=500)String externalChatId,@NotBlank @Size(max=120)String externalMessageId,@NotBlank @Pattern(regexp="INBOUND|OUTBOUND")String direction,@NotNull Instant createdAt,@Size(max=3000)String content){}
record PairingResponse(String pairingToken,Instant expiresAt,UUID accountId,String accountName){}
record DeviceCredentialsResponse(UUID deviceId,String deviceToken,UUID accountId,String accountName){}
record DeviceResponse(UUID id,UUID accountId,String accountName,String displayName,String status,String runtimeState,String stopReason,Instant lastHeartbeatAt,Instant createdAt,Instant revokedAt){static DeviceResponse from(BrowserDevice d){return new DeviceResponse(d.getId(),d.getBossAccount().getId(),d.getBossAccount().getDisplayName(),d.getDisplayName(),d.getStatus(),d.getRuntimeState(),d.getStopReason(),d.getLastHeartbeatAt(),d.getCreatedAt(),d.getRevokedAt());}}
record BindingResponse(UUID id,UUID accountId,UUID contactId,String candidateName,String jobTitle,String displayHint,Instant createdAt){static BindingResponse from(BrowserConversationBinding b){return new BindingResponse(b.getId(),b.getAccount().getId(),b.getContact().getId(),b.getContact().getCandidate().getDisplayName(),b.getContact().getJobPosition().getTitle(),b.getDisplayHint(),b.getCreatedAt());}}
record SyncMessageResponse(boolean replayed,boolean bound,UUID contactId,UUID messageId,String action){}
record BrowserRuntimePolicyResponse(boolean configured,boolean enabled,String awayMode,Instant awayEndsAt,boolean automaticSend,int timeoutMinutes,int dailyLimit,int sentToday,int minimumIntervalSeconds,String windowStart,String windowEnd,String timezone,String template,Instant serverNow,Instant lastSentAt,Instant pausedUntil){}
record CreateSendClaimRequest(@NotBlank @Size(max=500)String externalChatId,@NotBlank @Size(max=120)String inboundExternalMessageId,@NotBlank @Pattern(regexp="[a-fA-F0-9]{64}")String replyDigest){}
record SendClaimResponse(boolean allowed,String action,UUID claimId,Instant leaseUntil,int sentToday,int dailyLimit){}
record SendReceiptRequest(@NotBlank @Pattern(regexp="SENT|UNKNOWN")String status,@Size(max=120)String externalOutboundMessageId){}
record SendReceiptResponse(String status,int sentToday,Instant lastSentAt,Instant pausedUntil){}
record UnreadObservationEntry(@NotBlank@Pattern(regexp="[a-f0-9]{64}")String chatDigest,@Pattern(regexp="[a-f0-9]{64}")String previewDigest,@Pattern(regexp="[a-f0-9]{64}")String jobDigest,@Pattern(regexp="[a-f0-9]{64}")String timeDigest,@Min(0)@Max(999)int unreadCount,Instant firstSeenAt,Instant lastSeenAt){}
record UnreadObservationSnapshot(@NotNull@Size(max=200)List<@Valid UnreadObservationEntry> entries){}
record UnreadObservationSyncResponse(int activeUnread,int received,Instant serverNow){}
record UnreadObservationResponse(UUID id,UUID accountId,String accountName,String companyName,String anonymousKey,int unreadCount,boolean jobRecognized,boolean previewRecognized,Instant firstSeenAt,Instant lastSeenAt){static UnreadObservationResponse from(BrowserUnreadObservation x){return new UnreadObservationResponse(x.getId(),x.getAccount().getId(),x.getAccount().getDisplayName(),x.getAccount().getCompany().getName(),x.getChatDigest().substring(0,12),x.getUnreadCount(),x.getJobDigest()!=null,x.getPreviewDigest()!=null,x.getFirstSeenAt(),x.getLastSeenAt());}}
