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
export type CandidateSource = 'BOSS_MOCK' | 'MANUAL' | 'IMPORT'
export type CandidatePrivacyStatus = 'ACTIVE' | 'ANONYMIZED'
export type CandidateContactStatus = 'NEW' | 'SCREENING' | 'QUALIFIED' | 'REJECTED' | 'CONTACTING'
export type ScreeningOutcome = 'PASS' | 'REJECT' | 'REVIEW'
export type ScreeningDecisionType = 'HARD_RULE' | 'AI_SUGGESTION' | 'HUMAN_OVERRIDE'
export type MessageSenderType = 'CANDIDATE' | 'AI' | 'HR' | 'SYSTEM'
export type MessageDeliveryStatus = 'RECEIVED' | 'PENDING_REVIEW' | 'SENT' | 'REJECTED' | 'FAILED'
export interface ScreeningDecision { id: string; decisionType: ScreeningDecisionType; outcome: ScreeningOutcome; engineVersion?: string; modelVersion?: string; promptVersion?: string; rationale: string; createdBy?: { id: string; displayName: string }; createdAt: string }
export interface ConversationMessage { id: string; externalMessageId: string; direction: 'INBOUND' | 'OUTBOUND'; senderType: MessageSenderType; deliveryStatus: MessageDeliveryStatus; content: string; modelVersion?: string; promptVersion?: string; createdBy?: { id: string; displayName: string }; approvedAt?: string; createdAt: string }
export interface CandidateContact { id: string; candidateId: string; company: CompanyScope; jobPosition: { id: string; title: string }; bossAccount: { id: string; displayName: string }; source: CandidateSource; sourceReference: string; displayName: string; currentTitle?: string; yearsExperience?: number; education?: string; skillsSummary?: string; privacyStatus: CandidatePrivacyStatus; status: CandidateContactStatus; humanTakenOver: boolean; assignedHr?: { id: string; displayName: string }; latestHardRule?: ScreeningDecision; latestAiSuggestion?: ScreeningDecision; latestHumanOverride?: ScreeningDecision; latestMessageAt?:string;latestMessageDirection?:'INBOUND'|'OUTBOUND';latestMessagePreview?:string;needsHrFollowUp:boolean;pendingReviewDraft:boolean;latestAutoReplyStatus?:AutoReplyAttemptStatus;latestAutoReplyAt?:string; createdAt: string; updatedAt: string }
export interface CandidateDetail { candidate: CandidateContact; decisions: ScreeningDecision[]; messages: ConversationMessage[] }
export type AwayMode='IN_OFFICE'|'TEMPORARY'|'AFTER_HOURS'
export interface AutoReplyPolicy {accountId:string;accountName:string;companyId:string;companyName:string;accountStatus:BossAccountStatus;connectionStatus:BossConnectionStatus;messageSendCapable:boolean;configured:boolean;enabled:boolean;awayMode:AwayMode;awayStartedAt?:string;awayEndsAt?:string;awayActive:boolean;autoSendEnabled:boolean;responseTimeoutMinutes:number;dailyLimit:number;minimumIntervalSeconds:number;sendingWindowStart:string;sendingWindowEnd:string;timezone:string;maxConsecutiveFailures:number;consecutiveFailures:number;pausedUntil?:string;lastSentAt?:string;sentToday:number;quotaDate?:string;replyTemplate:string;version:number}
export type AutoReplyAttemptStatus='CLAIMED'|'PENDING_REVIEW'|'SENT'|'FAILED'|'SKIPPED'
export interface AutoReplyAttempt {id:string;accountId:string;accountName:string;contactId:string;candidateName:string;jobTitle:string;status:AutoReplyAttemptStatus;resultMessage?:string;outboundMessageId?:string;attemptCount:number;createdAt:string;completedAt?:string}
export interface BrowserDevice {id:string;accountId:string;accountName:string;displayName:string;status:'ACTIVE'|'REVOKED';runtimeState:'DISABLED'|'RUNNING'|'PAUSED'|'OFFLINE';stopReason?:string;lastHeartbeatAt?:string;createdAt:string;revokedAt?:string}
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; requestId?:string; occurredAt: string }
export interface GatewaySnapshot { operation:string;consecutiveFailures:number;circuitOpenUntil?:string;requestsInWindow:number;availablePermits:number }
export interface OperationsSummary { status:'READY';flywayVersion:string;auditAppendOnly:boolean;checkedAt:string;gateways:GatewaySnapshot[] }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
