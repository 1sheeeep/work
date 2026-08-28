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
export interface RecruitmentTask { id: string; jobPosition: { id: string; title: string; companyId: string; companyName: string; companyCode: string }; bossAccount: { id: string; displayName: string; externalIdentifier: string }; name: string; executionStrategy: ExecutionStrategy; dailyQuota: number; windowStart: string; windowEnd: string; timezone: string; requireManualReview: boolean; mockOutcome: MockExecutionOutcome; status: RecruitmentTaskStatus; processedToday: number; quotaDate?: string; lastRunAt?: string; lastError?: string; schedulerEnabled?:boolean;nextRunAt?:string;lastScheduledAt?:string;lastSchedulerOwner?:string;version: number; createdAt: string; updatedAt: string }
export interface TaskExecution { id: string; idempotencyKey: string; attemptNumber: number; requestedCount: number; processedCount: number; status: 'SUCCEEDED' | 'FAILED' | 'NEEDS_ATTENTION'; message?: string; startedAt: string; completedAt?: string }
export type CandidateSource = 'BOSS_MOCK' | 'MANUAL' | 'IMPORT'
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
export type CandidateImportRowStatus='VALID'|'INVALID'|'DUPLICATE_FILE'|'DUPLICATE_EXISTING'|'IMPORTED'
export interface CandidateImportRow {rowNumber:number;displayName?:string;currentTitle?:string;yearsExperience?:number;education?:string;skillsSummary?:string;status:CandidateImportRowStatus;validationMessage?:string;importedContactId?:string}
export interface CandidateImportBatch {id:string;companyId:string;jobPositionId:string;jobTitle:string;sourceFilename:string;fileFormat:'CSV'|'XLSX';status:'PREVIEWED'|'COMPLETED'|'FAILED';totalRows:number;validRows:number;invalidRows:number;duplicateRows:number;importedRows:number;createdBy:string;createdAt:string;completedAt?:string;rows:CandidateImportRow[]}
export interface AiJobSuggestion {title:string;location:string;salaryMinK:number;salaryMaxK:number;salaryMonths:number;experienceRequirement:string;educationRequirement:string;screeningRequirements:string;rationale:string}
export interface AiJobParseResponse {runId:string;provider:'MOCK'|'OPENAI_COMPATIBLE';modelVersion:string;promptVersion:string;suggestion:AiJobSuggestion}
export interface AiCandidateScreenResponse {runId:string;provider:'MOCK'|'OPENAI_COMPATIBLE';modelVersion:string;promptVersion:string;decision:ScreeningDecision}
export interface AutoReplyPolicy {accountId:string;accountName:string;companyId:string;companyName:string;accountStatus:BossAccountStatus;connectionStatus:BossConnectionStatus;messageSendCapable:boolean;configured:boolean;enabled:boolean;autoSendEnabled:boolean;responseTimeoutMinutes:number;dailyLimit:number;minimumIntervalSeconds:number;sendingWindowStart:string;sendingWindowEnd:string;timezone:string;maxConsecutiveFailures:number;consecutiveFailures:number;pausedUntil?:string;lastSentAt?:string;sentToday:number;quotaDate?:string;replyTemplate:string;version:number}
export type AutoReplyAttemptStatus='CLAIMED'|'PENDING_REVIEW'|'SENT'|'FAILED'|'SKIPPED'
export interface AutoReplyAttempt {id:string;accountId:string;accountName:string;contactId:string;candidateName:string;jobTitle:string;status:AutoReplyAttemptStatus;resultMessage?:string;outboundMessageId?:string;attemptCount:number;createdAt:string;completedAt?:string}
export type InterviewStatus = 'PROPOSING' | 'CONFIRMED' | 'RESCHEDULE_REQUIRED' | 'CANCELLED'
export type InterviewSlotStatus = 'AVAILABLE' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED'
export type MockNotificationOutcome = 'SUCCESS' | 'FAILURE'
export interface InterviewSlot { id: string; roundNumber: number; startsAt: string; endsAt: string; status: InterviewSlotStatus }
export interface NotificationAttempt { id: string; idempotencyKey: string; status: 'SENT'|'FAILED'; message?: string; attemptedAt: string }
export interface HrNotification { id: string; confirmationRound: number; recipientName: string; channel: 'IN_APP_MOCK'|'WEBHOOK'; status: 'PENDING'|'SENT'|'FAILED'; attemptCount: number; lastError?: string; sentAt?: string; createdAt: string; attempts: NotificationAttempt[] }
export interface InterviewSchedule { id: string; contact: { id:string;candidateName:string;privacyStatus:CandidatePrivacyStatus;companyId:string;companyName:string;jobPositionId:string;jobTitle:string }; ownerHr:{id:string;displayName:string}; timezone:string; status:InterviewStatus; currentRound:number; mockNotificationOutcome:MockNotificationOutcome; confirmedSlot?:InterviewSlot; currentSlots:InterviewSlot[]; version:number; createdAt:string; updatedAt:string }
export interface InterviewDetail { schedule:InterviewSchedule;slots:InterviewSlot[];notifications:HrNotification[] }
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; requestId?:string; occurredAt: string }
export interface GatewaySnapshot { operation:string;consecutiveFailures:number;circuitOpenUntil?:string;requestsInWindow:number;availablePermits:number }
export interface SchedulerSnapshot {enabled:boolean;instanceId:string;activeLeases:number;dueTasks:number;nextRunAt?:string}
export interface OperationsSummary { status:'READY';flywayVersion:string;auditAppendOnly:boolean;checkedAt:string;gateways:GatewaySnapshot[];scheduler?:SchedulerSnapshot;notification?:{mode:string;configured:boolean;trialEnabled:boolean} }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
