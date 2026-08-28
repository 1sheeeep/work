export type UserRole = 'SYSTEM_ADMIN' | 'RECRUITMENT_ADMIN' | 'RECRUITER'
export interface AuthenticatedUser { id: string; username: string; displayName: string; role: UserRole }
export interface GroupProfile { id: string; name: string; shortName: string; timezone: string; description?: string; version: number; updatedAt: string }
export type CompanyStatus = 'ACTIVE' | 'INACTIVE'
export interface Company { id: string; name: string; code: string; status: CompanyStatus; location?: string; notes?: string; version: number; createdAt: string; updatedAt: string }
export interface CompanyFormValue { name: string; code: string; location: string; notes: string }
export interface CompanyScope { id: string; name: string; code: string; status: CompanyStatus }
export interface HrUser { id: string; username: string; displayName: string; role: Exclude<UserRole, 'SYSTEM_ADMIN'>; enabled: boolean; companies: CompanyScope[]; createdAt: string; updatedAt: string }
export type BossAccountStatus = 'ACTIVE' | 'INACTIVE'
export type BossConnectionStatus = 'UNVERIFIED' | 'CONNECTED' | 'DEGRADED' | 'UNAVAILABLE'
export type BossCapability = 'JOB_SYNC' | 'CANDIDATE_READ' | 'MESSAGE_SEND' | 'INTERVIEW_INVITE'
export type MockBossProfile = 'FULL' | 'READ_ONLY' | 'UNAVAILABLE'
export interface BossAccount { id: string; company: CompanyScope; displayName: string; externalIdentifier: string; gatewayType: 'MOCK'; mockProfile: MockBossProfile; status: BossAccountStatus; connectionStatus: BossConnectionStatus; capabilities: BossCapability[]; lastCheckedAt?: string; version: number; createdAt: string; updatedAt: string }
export type JobPositionStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED'
export interface JobPositionBossAccount { id: string; displayName: string; externalIdentifier: string; status: BossAccountStatus; connectionStatus: BossConnectionStatus }
export interface JobPosition { id: string; company: CompanyScope; bossAccount: JobPositionBossAccount; title: string; location: string; salaryMinK: number; salaryMaxK: number; salaryMonths: number; experienceRequirement: string; educationRequirement: string; description: string; screeningRequirements?: string; status: JobPositionStatus; version: number; createdAt: string; updatedAt: string }
export type RecruitmentTaskStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'NEEDS_ATTENTION'
export type ExecutionStrategy = 'BALANCED' | 'QUALITY_FIRST' | 'FAST'
export type MockExecutionOutcome = 'SUCCESS' | 'FAILURE' | 'NEEDS_ATTENTION'
export interface RecruitmentTask { id: string; jobPosition: { id: string; title: string; companyId: string; companyName: string; companyCode: string }; bossAccount: { id: string; displayName: string; externalIdentifier: string }; name: string; executionStrategy: ExecutionStrategy; dailyQuota: number; windowStart: string; windowEnd: string; timezone: string; requireManualReview: boolean; mockOutcome: MockExecutionOutcome; status: RecruitmentTaskStatus; processedToday: number; quotaDate?: string; lastRunAt?: string; lastError?: string; version: number; createdAt: string; updatedAt: string }
export interface TaskExecution { id: string; idempotencyKey: string; attemptNumber: number; requestedCount: number; processedCount: number; status: 'SUCCEEDED' | 'FAILED' | 'NEEDS_ATTENTION'; message?: string; startedAt: string; completedAt?: string }
export type CandidateSource = 'BOSS_MOCK' | 'MANUAL'
export type CandidatePrivacyStatus = 'ACTIVE' | 'ANONYMIZED'
export type CandidateContactStatus = 'NEW' | 'SCREENING' | 'QUALIFIED' | 'REJECTED' | 'CONTACTING'
export type ScreeningOutcome = 'PASS' | 'REJECT' | 'REVIEW'
export type ScreeningDecisionType = 'HARD_RULE' | 'AI_SUGGESTION' | 'HUMAN_OVERRIDE'
export type MessageSenderType = 'CANDIDATE' | 'AI' | 'HR' | 'SYSTEM'
export type MessageDeliveryStatus = 'RECEIVED' | 'PENDING_REVIEW' | 'SENT' | 'REJECTED' | 'FAILED'
export interface ScreeningDecision { id: string; decisionType: ScreeningDecisionType; outcome: ScreeningOutcome; engineVersion?: string; modelVersion?: string; promptVersion?: string; rationale: string; createdBy?: { id: string; displayName: string }; createdAt: string }
export interface ConversationMessage { id: string; externalMessageId: string; direction: 'INBOUND' | 'OUTBOUND'; senderType: MessageSenderType; deliveryStatus: MessageDeliveryStatus; content: string; modelVersion?: string; promptVersion?: string; createdBy?: { id: string; displayName: string }; approvedAt?: string; createdAt: string }
export interface CandidateContact { id: string; candidateId: string; company: CompanyScope; jobPosition: { id: string; title: string }; bossAccount: { id: string; displayName: string }; source: CandidateSource; sourceReference: string; displayName: string; currentTitle?: string; yearsExperience?: number; education?: string; skillsSummary?: string; privacyStatus: CandidatePrivacyStatus; status: CandidateContactStatus; humanTakenOver: boolean; assignedHr?: { id: string; displayName: string }; latestHardRule?: ScreeningDecision; latestAiSuggestion?: ScreeningDecision; latestHumanOverride?: ScreeningDecision; createdAt: string; updatedAt: string }
export interface CandidateDetail { candidate: CandidateContact; decisions: ScreeningDecision[]; messages: ConversationMessage[] }
export type InterviewStatus = 'PROPOSING' | 'CONFIRMED' | 'RESCHEDULE_REQUIRED' | 'CANCELLED'
export type InterviewSlotStatus = 'AVAILABLE' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED'
export type MockNotificationOutcome = 'SUCCESS' | 'FAILURE'
export interface InterviewSlot { id: string; roundNumber: number; startsAt: string; endsAt: string; status: InterviewSlotStatus }
export interface NotificationAttempt { id: string; idempotencyKey: string; status: 'SENT'|'FAILED'; message?: string; attemptedAt: string }
export interface HrNotification { id: string; confirmationRound: number; recipientName: string; channel: 'IN_APP_MOCK'; status: 'PENDING'|'SENT'|'FAILED'; attemptCount: number; lastError?: string; sentAt?: string; createdAt: string; attempts: NotificationAttempt[] }
export interface InterviewSchedule { id: string; contact: { id:string;candidateName:string;privacyStatus:CandidatePrivacyStatus;companyId:string;companyName:string;jobPositionId:string;jobTitle:string }; ownerHr:{id:string;displayName:string}; timezone:string; status:InterviewStatus; currentRound:number; mockNotificationOutcome:MockNotificationOutcome; confirmedSlot?:InterviewSlot; currentSlots:InterviewSlot[]; version:number; createdAt:string; updatedAt:string }
export interface InterviewDetail { schedule:InterviewSchedule;slots:InterviewSlot[];notifications:HrNotification[] }
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; requestId?:string; occurredAt: string }
export interface GatewaySnapshot { operation:string;consecutiveFailures:number;circuitOpenUntil?:string;requestsInWindow:number;availablePermits:number }
export interface OperationsSummary { status:'READY';flywayVersion:string;auditAppendOnly:boolean;checkedAt:string;gateways:GatewaySnapshot[] }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
