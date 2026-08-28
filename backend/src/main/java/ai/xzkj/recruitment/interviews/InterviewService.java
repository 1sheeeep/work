package ai.xzkj.recruitment.interviews;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.notifications.*;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class InterviewService {
    private final InterviewScheduleRepository scheduleRepository; private final InterviewSlotRepository slotRepository;
    private final CandidateJobContactRepository contactRepository; private final HrNotificationRepository notificationRepository;
    private final NotificationAttemptRepository attemptRepository; private final CurrentUserService currentUserService;
    private final NotificationGateway notificationGateway; private final AuditService auditService;
    public InterviewService(InterviewScheduleRepository scheduleRepository,InterviewSlotRepository slotRepository,
            CandidateJobContactRepository contactRepository,HrNotificationRepository notificationRepository,
            NotificationAttemptRepository attemptRepository,CurrentUserService currentUserService,
            NotificationGateway notificationGateway,AuditService auditService){this.scheduleRepository=scheduleRepository;
        this.slotRepository=slotRepository;this.contactRepository=contactRepository;this.notificationRepository=notificationRepository;
        this.attemptRepository=attemptRepository;this.currentUserService=currentUserService;this.notificationGateway=notificationGateway;this.auditService=auditService;}

    @Transactional(readOnly=true)
    public List<InterviewScheduleResponse> list(String keyword,UUID companyId,InterviewStatus status){
        SystemUser user=currentUserService.requireCurrentUser();if(companyId!=null)requireCompanyAccess(companyId,user);
        String normalized=keyword==null?"":keyword.trim().toLowerCase(Locale.ROOT);
        return scheduleRepository.findAllByOrderByUpdatedAtDesc().stream().filter(s->canAccess(s.getContact().getCandidate().getCompany().getId(),user))
                .filter(s->companyId==null||companyId.equals(s.getContact().getCandidate().getCompany().getId()))
                .filter(s->status==null||status==s.getStatus()).filter(s->normalized.isBlank()
                        ||s.getContact().getCandidate().getDisplayName().toLowerCase(Locale.ROOT).contains(normalized)
                        ||s.getContact().getJobPosition().getTitle().toLowerCase(Locale.ROOT).contains(normalized)
                        ||s.getOwnerHr().getDisplayName().toLowerCase(Locale.ROOT).contains(normalized))
                .map(this::response).toList();
    }

    @Transactional(readOnly=true)
    public InterviewDetailResponse detail(UUID id){InterviewSchedule schedule=requireAccessible(id,currentUserService.requireCurrentUser());return detailResponse(schedule);}

    @Transactional
    public InterviewScheduleResponse create(InterviewCreateRequest request){SystemUser user=currentUserService.requireCurrentUser();
        CandidateJobContact contact=requireEligibleContact(request.contactId(),user);ZoneId zone=requireZone(request.timezone());validateSlots(request.slots(),zone);
        boolean active=scheduleRepository.findByContactIdOrderByCreatedAtDesc(contact.getId()).stream().anyMatch(s->s.getStatus()!=InterviewStatus.CANCELLED);
        if(active)throw new ApiException(HttpStatus.CONFLICT,"ACTIVE_INTERVIEW_EXISTS","该候选人职位关系已有未取消的面试安排");
        InterviewSchedule schedule=scheduleRepository.save(new InterviewSchedule(contact,user,zone.getId(),request.mockNotificationOutcome()));
        saveSlots(schedule,request.slots());auditService.success("CREATE_INTERVIEW_SCHEDULE","INTERVIEW_SCHEDULE",schedule.getId(),auditLabel(contact),
                "创建第 1 轮候选时间，时区 "+zone.getId());return response(schedule);}

    @Transactional
    public InterviewScheduleResponse reschedule(UUID id,InterviewSlotsRequest request){SystemUser user=currentUserService.requireCurrentUser();
        InterviewSchedule schedule=requireAccessible(id,user);if(schedule.getStatus()!=InterviewStatus.CONFIRMED&&schedule.getStatus()!=InterviewStatus.RESCHEDULE_REQUIRED)
            throw new ApiException(HttpStatus.CONFLICT,"INTERVIEW_NOT_RESCHEDULABLE","只有已确认或需重新约定的面试可以发起重约");
        validateSlots(request.slots(),requireZone(schedule.getTimezone()));schedule.beginNextRound();saveSlots(schedule,request.slots());schedule.reopenProposal();
        auditService.success("RESCHEDULE_INTERVIEW","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),"发起第 "+schedule.getCurrentRound()+" 轮时间约定");return response(schedule);}

    @Transactional
    public InterviewConfirmationResponse confirm(UUID id,UUID slotId,String idempotencyKey){SystemUser user=currentUserService.requireCurrentUser();
        InterviewSchedule schedule=requireAccessible(id,user);String key=cleanKey(idempotencyKey);
        if(key.equals(schedule.getConfirmationKey()))return confirmationResponse(schedule,schedule.getLastConfirmationResult(),true);
        if(schedule.getStatus()!=InterviewStatus.PROPOSING&&schedule.getStatus()!=InterviewStatus.RESCHEDULE_REQUIRED)
            throw new ApiException(HttpStatus.CONFLICT,"INTERVIEW_NOT_CONFIRMABLE","当前面试不处于候选时间确认阶段");
        InterviewSlot selected=slotRepository.findByIdAndScheduleId(slotId,id).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"INTERVIEW_SLOT_NOT_FOUND","候选时间不存在"));
        if(selected.getRoundNumber()!=schedule.getCurrentRound()||selected.getStatus()!=InterviewSlotStatus.AVAILABLE)
            throw new ApiException(HttpStatus.CONFLICT,"INTERVIEW_SLOT_NOT_AVAILABLE","该候选时间已不可用");
        if(!selected.getStartsAt().isAfter(Instant.now())){selected.expire();schedule.requireReschedule(key,InterviewConfirmationResult.EXPIRED);
            auditService.success("CONFIRM_INTERVIEW_EXPIRED","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),"候选时间已过期，进入重新约定");
            return confirmationResponse(schedule,InterviewConfirmationResult.EXPIRED,false);}
        boolean conflict=scheduleRepository.findByOwnerHrIdAndStatus(schedule.getOwnerHr().getId(),InterviewStatus.CONFIRMED).stream()
                .filter(other->!other.getId().equals(schedule.getId())).map(InterviewSchedule::getConfirmedSlot).filter(Objects::nonNull)
                .anyMatch(slot->overlaps(selected.getStartsAt(),selected.getEndsAt(),slot.getStartsAt(),slot.getEndsAt()));
        if(conflict){schedule.requireReschedule(key,InterviewConfirmationResult.CONFLICT);
            auditService.success("CONFIRM_INTERVIEW_CONFLICT","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),"负责 HR 时间冲突，进入重新约定");
            return confirmationResponse(schedule,InterviewConfirmationResult.CONFLICT,false);}
        selected.confirm();slotRepository.findByScheduleIdAndRoundNumberOrderByStartsAtAsc(id,schedule.getCurrentRound()).stream()
                .filter(slot->!slot.getId().equals(selected.getId())&&slot.getStatus()==InterviewSlotStatus.AVAILABLE).forEach(InterviewSlot::decline);
        schedule.confirm(selected,key);HrNotification notification=notificationRepository.findByScheduleIdAndConfirmationRound(id,schedule.getCurrentRound())
                .orElseGet(()->notificationRepository.save(new HrNotification(schedule,schedule.getCurrentRound(),schedule.getOwnerHr())));
        Delivery delivery=deliver(schedule,notification,key);auditService.success("CONFIRM_INTERVIEW","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),
                "面试时间已确认，HR 通知结果 "+delivery.notification().status().name());
        return new InterviewConfirmationResponse(response(schedule),InterviewConfirmationResult.CONFIRMED,delivery.notification(),false);}

    @Transactional
    public NotificationRetryResponse retryNotification(UUID scheduleId,UUID notificationId,String idempotencyKey){SystemUser user=currentUserService.requireCurrentUser();
        InterviewSchedule schedule=requireAccessible(scheduleId,user);HrNotification notification=notificationRepository.findWithRecipientById(notificationId)
                .filter(item->item.getSchedule().getId().equals(scheduleId)).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"HR_NOTIFICATION_NOT_FOUND","HR 通知不存在"));
        Delivery delivery=deliver(schedule,notification,cleanKey(idempotencyKey));auditService.success("RETRY_HR_NOTIFICATION","INTERVIEW_SCHEDULE",scheduleId,auditLabel(schedule.getContact()),
                "重试 HR 通知，结果 "+delivery.notification().status().name());return new NotificationRetryResponse(delivery.notification(),delivery.replayed());}

    @Transactional
    public InterviewScheduleResponse updateMockOutcome(UUID id,NotificationOutcomeRequest request){InterviewSchedule schedule=requireAccessible(id,currentUserService.requireCurrentUser());
        schedule.updateMockOutcome(request.outcome());auditService.success("UPDATE_NOTIFICATION_MOCK","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),"更新 Mock 通知结果为 "+request.outcome());return response(schedule);}

    @Transactional
    public InterviewScheduleResponse cancel(UUID id){InterviewSchedule schedule=requireAccessible(id,currentUserService.requireCurrentUser());
        if(schedule.getStatus()==InterviewStatus.CANCELLED)return response(schedule);schedule.cancel();auditService.success("CANCEL_INTERVIEW","INTERVIEW_SCHEDULE",id,auditLabel(schedule.getContact()),"取消面试安排");return response(schedule);}

    private Delivery deliver(InterviewSchedule schedule,HrNotification notification,String key){var existing=attemptRepository.findByNotificationIdAndIdempotencyKey(notification.getId(),key);
        if(existing.isPresent()||notification.getStatus()==NotificationStatus.SENT)return new Delivery(notificationResponse(notification),true);
        InterviewSlot slot=schedule.getConfirmedSlot();var result=notificationGateway.notifyInterview(new NotificationGateway.NotificationRequest(notification.getId(),
                notification.getRecipient().getId(),key,auditLabel(schedule.getContact()),schedule.getContact().getJobPosition().getTitle(),slot.getStartsAt(),
                schedule.getTimezone(),schedule.getMockNotificationOutcome().name()));attemptRepository.save(new NotificationAttempt(notification,key,result.succeeded(),result.message()));
        notification.apply(result.succeeded(),result.message());return new Delivery(notificationResponse(notification),false);}
    private InterviewConfirmationResponse confirmationResponse(InterviewSchedule schedule,InterviewConfirmationResult result,boolean replayed){
        HrNotificationResponse notification=notificationRepository.findByScheduleIdAndConfirmationRound(schedule.getId(),schedule.getCurrentRound())
                .map(this::notificationResponse).orElse(null);return new InterviewConfirmationResponse(response(schedule),result,notification,replayed);}
    private InterviewDetailResponse detailResponse(InterviewSchedule schedule){List<InterviewSlot> slots=slotRepository.findByScheduleIdOrderByRoundNumberDescStartsAtAsc(schedule.getId());
        List<HrNotificationResponse> notifications=notificationRepository.findByScheduleIdOrderByConfirmationRoundDesc(schedule.getId()).stream().map(this::notificationResponse).toList();
        return new InterviewDetailResponse(response(schedule),slots.stream().map(InterviewSlotResponse::from).toList(),notifications);}
    private HrNotificationResponse notificationResponse(HrNotification notification){return HrNotificationResponse.from(notification,
            attemptRepository.findByNotificationIdOrderByAttemptedAtDesc(notification.getId()));}
    private InterviewScheduleResponse response(InterviewSchedule schedule){return InterviewScheduleResponse.from(schedule,
            slotRepository.findByScheduleIdAndRoundNumberOrderByStartsAtAsc(schedule.getId(),schedule.getCurrentRound()));}
    private void saveSlots(InterviewSchedule schedule,List<InterviewSlotRequest> slots){slots.forEach(slot->slotRepository.save(new InterviewSlot(schedule,schedule.getCurrentRound(),slot.startsAt(),slot.endsAt())));}
    private void validateSlots(List<InterviewSlotRequest> slots,ZoneId zone){requireZone(zone.getId());List<InterviewSlotRequest> sorted=slots.stream().sorted(Comparator.comparing(InterviewSlotRequest::startsAt)).toList();
        Instant minimum=Instant.now().plusSeconds(60);for(InterviewSlotRequest slot:sorted){if(!slot.startsAt().isAfter(minimum))throw new ApiException(HttpStatus.BAD_REQUEST,"INTERVIEW_SLOT_NOT_FUTURE","候选时间必须晚于当前时间");
            if(!slot.endsAt().isAfter(slot.startsAt()))throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INTERVIEW_SLOT","候选时间结束必须晚于开始");
            Duration duration=Duration.between(slot.startsAt(),slot.endsAt());if(duration.toMinutes()<15||duration.toHours()>8)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INTERVIEW_DURATION","面试时长必须在 15 分钟到 8 小时之间");}
        for(int i=1;i<sorted.size();i++)if(sorted.get(i).startsAt().isBefore(sorted.get(i-1).endsAt()))throw new ApiException(HttpStatus.BAD_REQUEST,"OVERLAPPING_INTERVIEW_SLOTS","同一轮候选时间不能重叠");}
    private CandidateJobContact requireEligibleContact(UUID id,SystemUser user){CandidateJobContact contact=contactRepository.findWithDetailsById(id)
            .orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"CANDIDATE_CONTACT_NOT_FOUND","候选人职位关系不存在"));requireCompanyAccess(contact.getCandidate().getCompany().getId(),user);
        if(contact.getCandidate().getPrivacyStatus()!=CandidatePrivacyStatus.ACTIVE)throw new ApiException(HttpStatus.CONFLICT,"CANDIDATE_ANONYMIZED","已匿名候选人不能安排面试");
        if(contact.getStatus()!=CandidateContactStatus.QUALIFIED&&contact.getStatus()!=CandidateContactStatus.CONTACTING)throw new ApiException(HttpStatus.CONFLICT,"CANDIDATE_NOT_READY_FOR_INTERVIEW","只有已通过或沟通中的候选人可以安排面试");return contact;}
    private InterviewSchedule requireAccessible(UUID id,SystemUser user){InterviewSchedule schedule=scheduleRepository.findWithDetailsById(id)
            .orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"INTERVIEW_SCHEDULE_NOT_FOUND","面试安排不存在"));requireCompanyAccess(schedule.getContact().getCandidate().getCompany().getId(),user);return schedule;}
    private ZoneId requireZone(String timezone){try{return ZoneId.of(timezone.trim());}catch(DateTimeException e){throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_TIMEZONE","请使用有效 IANA 时区，例如 Asia/Shanghai");}}
    private boolean overlaps(Instant aStart,Instant aEnd,Instant bStart,Instant bEnd){return aStart.isBefore(bEnd)&&bStart.isBefore(aEnd);}
    private String cleanKey(String key){if(key==null||key.isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_REQUIRED","确认或通知重试必须提供 Idempotency-Key");String clean=key.trim();if(clean.length()>100)throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_TOO_LONG","Idempotency-Key 不能超过 100 个字符");return clean;}
    private void requireCompanyAccess(UUID companyId,SystemUser user){if(!canAccess(companyId,user))throw new ApiException(HttpStatus.FORBIDDEN,"COMPANY_SCOPE_FORBIDDEN","当前账号无权访问该企业数据");}
    private boolean canAccess(UUID companyId,SystemUser user){return user.getRole()==UserRole.SYSTEM_ADMIN||allowedIds(user).contains(companyId);}
    private Set<UUID> allowedIds(SystemUser user){return user.getCompanyScopes().stream().map(Company::getId).collect(Collectors.toSet());}
    private String auditLabel(CandidateJobContact contact){return contact.getCandidate().getSource()+" · "+contact.getCandidate().getDedupKey().substring(0,8);}
    private record Delivery(HrNotificationResponse notification,boolean replayed){}
}
