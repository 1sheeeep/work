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
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; occurredAt: string }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
