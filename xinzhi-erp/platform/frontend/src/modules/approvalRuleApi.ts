import { apiClient, ApiError } from '../api/client'

const BASE = '/api/v1/settings/approval-rules'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const approvalDocumentTypes = [
  'PROCUREMENT_ORDER', 'INVENTORY_COUNT', 'WAREHOUSE_TRANSFER',
  'MANUAL_INBOUND', 'MANUAL_OUTBOUND',
] as const
export type ApprovalDocumentType = typeof approvalDocumentTypes[number]
export type ApprovalRuleApprover = { userId: string; displayName: string; stepOrder: number }
export type ApprovalRule = {
  id: string; priority: number; name: string; documentType: ApprovalDocumentType
  description?: string; enabled: boolean; approvers: ApprovalRuleApprover[]
  version: number; createdByDisplayName: string; updatedByDisplayName: string
  createdAt: string; updatedAt: string
}
export type ApprovalRulePage = { items: ApprovalRule[]; page: number; size: number; totalElements: number; totalPages: number }
export type ApprovalRuleQuery = { enabled?: boolean; documentType?: ApprovalDocumentType; keyword?: string; page?: number; size?: 25 | 50 | 100 }
export type ApprovalRuleInput = { priority: number; name: string; documentType: ApprovalDocumentType; description?: string; enabled: boolean; approverUserIds: string[] }
export type ApproverCandidate = { userId: string; displayName: string }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function invalid(): never { throw new ApiError('Invalid approval rule response', { status: 502, code: 'invalid_response' }) }
function text(value: unknown, required = true) { if (value == null && !required) return undefined; if (typeof value !== 'string' || (required && !value.trim())) invalid(); return value as string }
function integer(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); return Number(value) }
function parseApprover(value: unknown): ApprovalRuleApprover { const s = object(value); const userId = text(s.userId)!; if (!UUID.test(userId)) invalid(); return { userId, displayName: text(s.displayName)!, stepOrder: integer(s.stepOrder) } }
function parseRule(value: unknown): ApprovalRule { const s = object(value); const id = text(s.id)!; if (!UUID.test(id) || !approvalDocumentTypes.includes(s.documentType as ApprovalDocumentType) || typeof s.enabled !== 'boolean' || !Array.isArray(s.approvers)) invalid(); return { id, priority: integer(s.priority), name: text(s.name)!, documentType: s.documentType as ApprovalDocumentType, description: text(s.description, false), enabled: s.enabled, approvers: s.approvers.map(parseApprover), version: integer(s.version), createdByDisplayName: text(s.createdByDisplayName)!, updatedByDisplayName: text(s.updatedByDisplayName)!, createdAt: text(s.createdAt)!, updatedAt: text(s.updatedAt)! } }
function parsePage(value: unknown): ApprovalRulePage { const s = object(value); if (!Array.isArray(s.items)) invalid(); return { items: s.items.map(parseRule), page: integer(s.page), size: integer(s.size), totalElements: integer(s.totalElements), totalPages: integer(s.totalPages) } }
function parseCandidate(value: unknown): ApproverCandidate { const s = object(value); const userId = text(s.userId)!; if (!UUID.test(userId)) invalid(); return { userId, displayName: text(s.displayName)! } }
function normalize(input: ApprovalRuleInput) { const name = input.name.trim(); const description = input.description?.trim() || undefined; if (!Number.isSafeInteger(input.priority) || input.priority < 1 || input.priority > 10 || !name || name.length > 120 || !approvalDocumentTypes.includes(input.documentType) || (description?.length ?? 0) > 500 || input.approverUserIds.length < 1 || input.approverUserIds.length > 5 || input.approverUserIds.some((id) => !UUID.test(id)) || new Set(input.approverUserIds).size !== input.approverUserIds.length) { throw new ApiError('Invalid approval rule request', { status: 400, code: 'invalid_request' }) } return { ...input, name, description } }
function requestId() { return `settings-approval.${crypto.randomUUID()}` }

export const approvalRuleApi = {
  async list(query: ApprovalRuleQuery, signal?: AbortSignal) { const p = new URLSearchParams(); if (query.enabled !== undefined) p.set('enabled', String(query.enabled)); if (query.documentType) p.set('documentType', query.documentType); if (query.keyword) p.set('keyword', query.keyword.trim().slice(0, 120)); p.set('page', String(query.page ?? 0)); p.set('size', String(query.size ?? 25)); return parsePage(await apiClient.request<unknown>(`${BASE}?${p}`, { signal })) },
  async candidates(signal?: AbortSignal) { const value = await apiClient.request<unknown>(`${BASE}/approver-candidates`, { signal }); if (!Array.isArray(value)) invalid(); return value.map(parseCandidate) },
  async create(input: ApprovalRuleInput) { return parseRule(await apiClient.request<unknown>(BASE, { method: 'POST', body: normalize(input), headers: { 'X-Request-Id': requestId() } })) },
  async update(id: string, expectedVersion: number, input: ApprovalRuleInput) { if (!UUID.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) invalid(); return parseRule(await apiClient.request<unknown>(`${BASE}/${id}`, { method: 'PUT', body: { expectedVersion, ...normalize(input) }, headers: { 'X-Request-Id': requestId() } })) },
  async setEnabled(id: string, expectedVersion: number, enabled: boolean) { if (!UUID.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) invalid(); return parseRule(await apiClient.request<unknown>(`${BASE}/${id}/status`, { method: 'PATCH', body: { expectedVersion, enabled }, headers: { 'X-Request-Id': requestId() } })) },
  async remove(id: string, expectedVersion: number) { if (!UUID.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) invalid(); await apiClient.request<unknown>(`${BASE}/${id}?expectedVersion=${expectedVersion}`, { method: 'DELETE', headers: { 'X-Request-Id': requestId() } }) },
}
