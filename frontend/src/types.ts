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
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; occurredAt: string }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
