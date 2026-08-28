package ai.xzkj.recruitment.autoreply;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.*;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class AutoReplyService {
    public static final String DEFAULT_TEMPLATE="您好，感谢您的消息。我们已经收到您对「{jobTitle}」职位的咨询，招聘团队会尽快查看并与您进一步沟通。";
    private final AutoReplyPolicyRepository policies;private final AutoReplyAttemptRepository attempts;private final BossAccountRepository accounts;
    private final ConversationMessageRepository messages;private final CurrentUserService users;private final BossGateway gateway;private final AuditService audit;
    public AutoReplyService(AutoReplyPolicyRepository policies,AutoReplyAttemptRepository attempts,BossAccountRepository accounts,ConversationMessageRepository messages,CurrentUserService users,BossGateway gateway,AuditService audit){this.policies=policies;this.attempts=attempts;this.accounts=accounts;this.messages=messages;this.users=users;this.gateway=gateway;this.audit=audit;}

    @Transactional(readOnly=true) public List<AutoReplyResponse> listPolicies(){SystemUser user=users.requireCurrentUser();Map<UUID,AutoReplyPolicy> configured=policies.findAllByOrderByCreatedAtDesc().stream().collect(Collectors.toMap(p->p.getBossAccount().getId(),p->p));return accounts.findAllByOrderByCreatedAtDesc().stream().filter(a->canAccess(a.getCompany().getId(),user)).map(a->configured.containsKey(a.getId())?AutoReplyResponse.from(configured.get(a.getId())):AutoReplyResponse.unconfigured(a,DEFAULT_TEMPLATE)).toList();}
    @Transactional(readOnly=true) public List<AutoReplyAttemptResponse> listAttempts(){SystemUser user=users.requireCurrentUser();return attempts.findTop100ByOrderByCreatedAtDesc().stream().filter(a->canAccess(a.getBossAccount().getCompany().getId(),user)).map(AutoReplyAttemptResponse::from).toList();}

    @Transactional public AutoReplyResponse update(UUID accountId,AutoReplyRequest request){SystemUser user=requireManager();BossAccount account=accounts.findWithDetailsById(accountId).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"BOSS_ACCOUNT_NOT_FOUND","BOSS 账号不存在"));requireAccess(account.getCompany().getId(),user);validate(request,account);AutoReplyPolicy policy=policies.findByBossAccountId(accountId).orElseGet(()->policies.save(new AutoReplyPolicy(account,user,DEFAULT_TEMPLATE)));policy.update(request.enabled(),request.autoSendEnabled(),request.responseTimeoutMinutes(),request.dailyLimit(),request.minimumIntervalSeconds(),request.sendingWindowStart(),request.sendingWindowEnd(),request.timezone().trim(),request.maxConsecutiveFailures(),request.replyTemplate().trim(),user);audit.success("UPDATE_AUTO_REPLY_POLICY","BOSS_ACCOUNT",accountId,account.getDisplayName(),"更新多账号自动回复策略："+(request.enabled()?"启用":"停用")+"，"+(request.autoSendEnabled()?"自动发送":"人工审核"));return AutoReplyResponse.from(policy);}

    @Transactional public void process(UUID attemptId){AutoReplyAttempt attempt=attempts.findWithDetailsById(attemptId).orElse(null);if(attempt==null||attempt.getStatus()!=AutoReplyAttemptStatus.CLAIMED)return;AutoReplyPolicy policy=policies.findLockedById(attempt.getPolicy().getId()).orElse(null);if(policy==null)return;Instant now=Instant.now();CandidateJobContact contact=attempt.getContact();BossAccount account=attempt.getBossAccount();
        if(!policy.isEnabled()||contact.isHumanTakenOver()||contact.getCandidate().getPrivacyStatus()!=CandidatePrivacyStatus.ACTIVE||contact.getStatus()==CandidateContactStatus.REJECTED){skip(attempt,"策略已停用、候选人不可联系或会话已人工接管",now);return;}
        ConversationMessage latest=messages.findFirstByContactIdOrderByCreatedAtDescIdDesc(contact.getId()).orElse(null);if(latest==null||!latest.getId().equals(attempt.getInboundMessage().getId())){skip(attempt,"会话已有更新，不再自动回复",now);return;}
        if(!policy.canSend(now)){attempt.defer(policy.getPausedUntil(),"账号因连续失败暂停自动回复");return;}
        if(account.getStatus()!=BossAccountStatus.ACTIVE||(account.getConnectionStatus()!=BossConnectionStatus.CONNECTED&&account.getConnectionStatus()!=BossConnectionStatus.DEGRADED)||!account.getCapabilities().contains(BossCapability.MESSAGE_SEND)){policy.failed(now);fail(attempt,"账号不可用或缺少 MESSAGE_SEND 官方能力",now);return;}
        ZoneId zone;try{zone=ZoneId.of(policy.getTimezone());}catch(Exception e){policy.failed(now);fail(attempt,"策略时区无效",now);return;}ZonedDateTime local=now.atZone(zone);policy.prepareQuota(local.toLocalDate());
        if(!insideWindow(local.toLocalTime(),policy.getSendingWindowStart(),policy.getSendingWindowEnd())){attempt.defer(nextWindow(local,policy.getSendingWindowStart()).toInstant(),"当前处于静默时段");return;}
        if(policy.getSentToday()>=policy.getDailyLimit()){attempt.defer(local.toLocalDate().plusDays(1).atTime(policy.getSendingWindowStart()).atZone(zone).toInstant(),"账号已达到当日回复上限");return;}
        if(!policy.intervalElapsed(now)){attempt.defer(policy.getLastSentAt().plusSeconds(policy.getMinimumIntervalSeconds()),"等待账号最小发送间隔");return;}
        String content=policy.getReplyTemplate().replace("{jobTitle}",contact.getJobPosition().getTitle());ConversationMessage outbound=messages.save(new ConversationMessage(contact,attempt.getIdempotencyKey(),MessageDirection.OUTBOUND,MessageSenderType.AI,MessageDeliveryStatus.PENDING_REVIEW,content,"auto-follow-up-template-v1","auto-follow-up-v1",null));
        if(!policy.isAutoSendEnabled()){policy.sent(now);attempt.complete(AutoReplyAttemptStatus.PENDING_REVIEW,outbound,"已生成待 HR 审核草稿",now);audit.systemSuccess("DRAFT_AUTO_REPLY","CANDIDATE_CONTACT",contact.getId(),account.getDisplayName(),"超时会话生成待审核草稿，不记录消息正文");return;}
        var result=gateway.sendMessage(account,new BossGateway.MessageSendRequest(contact.getId(),attempt.getIdempotencyKey(),content));if(result.succeeded()){outbound.sent();contact.markContacting();policy.sent(now);attempt.complete(AutoReplyAttemptStatus.SENT,outbound,result.message(),now);audit.systemSuccess("SEND_AUTO_REPLY","CANDIDATE_CONTACT",contact.getId(),account.getDisplayName(),"账号自动回复成功，不记录消息正文");}else{outbound.failed();policy.failed(now);attempt.complete(AutoReplyAttemptStatus.FAILED,outbound,result.message(),now);audit.systemSuccess("FAIL_AUTO_REPLY","CANDIDATE_CONTACT",contact.getId(),account.getDisplayName(),"自动回复失败，连续失败 "+policy.getConsecutiveFailures()+" 次");}}

    private void validate(AutoReplyRequest r,BossAccount a){try{ZoneId.of(r.timezone().trim());}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_TIMEZONE","请输入有效 IANA 时区");}if(r.sendingWindowStart().equals(r.sendingWindowEnd()))throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_SENDING_WINDOW","发送窗口开始和结束时间不能相同");if(r.autoSendEnabled()&&!r.enabled())throw new ApiException(HttpStatus.BAD_REQUEST,"AUTO_SEND_REQUIRES_ENABLED","开启自动发送前必须启用策略");if(r.enabled()&&(a.getStatus()!=BossAccountStatus.ACTIVE||(a.getConnectionStatus()!=BossConnectionStatus.CONNECTED&&a.getConnectionStatus()!=BossConnectionStatus.DEGRADED)||!a.getCapabilities().contains(BossCapability.MESSAGE_SEND)))throw new ApiException(HttpStatus.BAD_REQUEST,"MESSAGE_SEND_UNAVAILABLE","账号必须已连接、已启用且具备官方 MESSAGE_SEND 能力");}
    private boolean insideWindow(LocalTime n,LocalTime s,LocalTime e){return s.isBefore(e)?!n.isBefore(s)&&n.isBefore(e):!n.isBefore(s)||n.isBefore(e);}private ZonedDateTime nextWindow(ZonedDateTime now,LocalTime start){ZonedDateTime today=now.toLocalDate().atTime(start).atZone(now.getZone());return today.isAfter(now)?today:today.plusDays(1);}private void skip(AutoReplyAttempt a,String m,Instant n){a.complete(AutoReplyAttemptStatus.SKIPPED,null,m,n);}private void fail(AutoReplyAttempt a,String m,Instant n){a.complete(AutoReplyAttemptStatus.FAILED,null,m,n);}
    private SystemUser requireManager(){SystemUser u=users.requireCurrentUser();if(u.getRole()==UserRole.RECRUITER)throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","当前账号没有自动回复策略管理权限");return u;}private void requireAccess(UUID company,SystemUser u){if(!canAccess(company,u))throw new ApiException(HttpStatus.FORBIDDEN,"COMPANY_SCOPE_FORBIDDEN","当前账号无权访问该企业数据");}private boolean canAccess(UUID company,SystemUser u){return u.getRole()==UserRole.SYSTEM_ADMIN||u.getCompanyScopes().stream().map(Company::getId).anyMatch(company::equals);}
}
