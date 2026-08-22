export type UserRole = 'SYSTEM_ADMIN' | 'RECRUITMENT_ADMIN' | 'RECRUITER'
export interface AuthenticatedUser { id: string; username: string; displayName: string; role: UserRole }
export interface GroupProfile { id: string; name: string; shortName: string; timezone: string; description?: string; version: number; updatedAt: string }
export type CompanyStatus = 'ACTIVE' | 'INACTIVE'
export interface Company { id: string; name: string; code: string; status: CompanyStatus; location?: string; notes?: string; version: number; createdAt: string; updatedAt: string }
export interface CompanyFormValue { name: string; code: string; location: string; notes: string }
export interface AuditLog { id: string; actorName: string; action: string; targetType: string; targetId?: string; targetLabel?: string; result: 'SUCCESS' | 'FAILURE'; details?: string; occurredAt: string }
export interface ApiErrorBody { status: number; code: string; message: string; fieldErrors?: Record<string, string> }
