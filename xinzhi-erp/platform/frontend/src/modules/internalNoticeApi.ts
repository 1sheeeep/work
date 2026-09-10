import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/settings/internal-notices'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const INTERNAL_NOTICE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type InternalNoticeStatus = typeof INTERNAL_NOTICE_STATUSES[number]
export type InternalNotice = {
  id: string
  title: string
  content: string
  pinned: boolean
  status: InternalNoticeStatus
  publishedAt: string
  archivedAt?: string
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type InternalNoticePage = {
  items: InternalNotice[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type InternalNoticeFilters = {
  title?: string
  status: InternalNoticeStatus
  pinned?: boolean
}
export type InternalNoticeInput = {
  title: string
  content: string
  pinned: boolean
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid internal notice response', { status: 502, code: 'invalid_response', details: { field } }) }
function bad(field: string): never { throw new ApiError('Invalid internal notice request', { status: 400, code: 'invalid_request', details: { field } }) }
function object(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string, maximum: number) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(field); return value }
function multiline(value: unknown, field: string, maximum: number) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(field); return value }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function instant(value: unknown, field: string) { const result = text(value, field, 64); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function optionalInstant(value: unknown, field: string) { return value === null ? undefined : instant(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field, 36); if (!UUID.test(result)) invalid(field); return result }
function status(value: unknown): InternalNoticeStatus { if (!INTERNAL_NOTICE_STATUSES.includes(value as InternalNoticeStatus)) invalid('notice.status'); return value as InternalNoticeStatus }

function notice(value: unknown): InternalNotice {
  const wire = object(value, 'notice')
  exact(wire, ['id', 'title', 'content', 'pinned', 'status', 'publishedAt', 'archivedAt', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'], 'notice')
  if (typeof wire.pinned !== 'boolean') invalid('notice.pinned')
  const result: InternalNotice = {
    id: uuid(wire.id, 'notice.id'), title: text(wire.title, 'notice.title', 160),
    content: multiline(wire.content, 'notice.content', 4000), pinned: wire.pinned,
    status: status(wire.status), publishedAt: instant(wire.publishedAt, 'notice.publishedAt'),
    archivedAt: optionalInstant(wire.archivedAt, 'notice.archivedAt'),
    createdByDisplayName: text(wire.createdByDisplayName, 'notice.createdByDisplayName', 160),
    version: integer(wire.version, 'notice.version'), createdAt: instant(wire.createdAt, 'notice.createdAt'),
    updatedAt: instant(wire.updatedAt, 'notice.updatedAt'),
  }
  if ((result.status === 'ARCHIVED') !== Boolean(result.archivedAt) || (result.status === 'ARCHIVED' && result.pinned)) invalid('notice.lifecycle')
  return result
}

function page(value: unknown): InternalNoticePage {
  const wire = object(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(notice), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  if (result.size < 1 || result.size > 100 || result.items.length > result.size || result.items.length > result.totalElements || result.totalPages !== (result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size))) invalid('page.identity')
  return result
}

function validateInput(input: InternalNoticeInput) {
  const title = input.title.trim(); const content = input.content.trim()
  if (!title || title.length > 160 || !content || content.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(`${title}${content}`)) bad('notice')
}
function requestId() { return `settings-notice.${crypto.randomUUID()}` }

export const internalNoticeApi = {
  async list(input: InternalNoticeFilters & { page: number; size: number; signal?: AbortSignal }) {
    if (!INTERNAL_NOTICE_STATUSES.includes(input.status) || !Number.isSafeInteger(input.page) || input.page < 0 || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 100) bad('page')
    const query = new URLSearchParams({ status: input.status, page: String(input.page), size: String(input.size) })
    if (input.title?.trim()) query.set('title', input.title.trim().slice(0, 160))
    if (input.pinned !== undefined) query.set('pinned', String(input.pinned))
    const result = page(await apiClient.request<unknown>(`${BASE}?${query}`, { signal: input.signal }))
    if (result.page !== input.page || result.size !== input.size) invalid('page.requestIdentity')
    return result
  },
  async create(input: InternalNoticeInput) {
    validateInput(input)
    return notice(await apiClient.request<unknown>(BASE, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { title: input.title.trim(), content: input.content.trim(), pinned: input.pinned } }))
  },
  async setPinned(id: string, version: number, pinned: boolean) {
    if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 0) bad('pin')
    return notice(await apiClient.request<unknown>(`${BASE}/${id}/pin`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version, pinned } }))
  },
  async transition(id: string, version: number, next: InternalNoticeStatus) {
    if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 0 || !INTERNAL_NOTICE_STATUSES.includes(next)) bad('transition')
    return notice(await apiClient.request<unknown>(`${BASE}/${id}/status`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version, status: next } }))
  },
  async archiveBatch(notices: Array<Pick<InternalNotice, 'id' | 'version'>>) {
    if (!notices.length || notices.length > 100 || new Set(notices.map((item) => item.id)).size !== notices.length || notices.some((item) => !UUID.test(item.id) || !Number.isSafeInteger(item.version) || item.version < 0)) bad('batch')
    const wire = await apiClient.request<unknown>(`${BASE}/batch-archive`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { notices } })
    if (!Array.isArray(wire)) invalid('batch')
    return wire.map(notice)
  },
}
