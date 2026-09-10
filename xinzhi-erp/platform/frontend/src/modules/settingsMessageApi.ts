import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/settings/messages'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MESSAGE_TYPES = ['INTERNAL_NOTICE'] as const
const READ_STATES = ['ALL', 'UNREAD', 'READ'] as const

export type SettingsMessageType = typeof MESSAGE_TYPES[number]
export type SettingsMessageReadState = typeof READ_STATES[number]
export type SettingsMessage = {
  id: string
  title: string
  content: string
  type: SettingsMessageType
  pinned: boolean
  createdByDisplayName: string
  publishedAt: string
  read: boolean
  readAt?: string
}
export type SettingsMessagePage = {
  items: SettingsMessage[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type SettingsMessageFilters = {
  startDate?: string
  endDate?: string
  type?: SettingsMessageType
  readState: SettingsMessageReadState
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid settings message response', { status: 502, code: 'invalid_response', details: { field } }) }
function bad(field: string): never { throw new ApiError('Invalid settings message request', { status: 400, code: 'invalid_request', details: { field } }) }
function object(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string, maximum: number) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(field); return value }
function multiline(value: unknown, field: string, maximum: number) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(field); return value }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function instant(value: unknown, field: string) { const result = text(value, field, 64); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function optionalInstant(value: unknown, field: string) { return value === null ? undefined : instant(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field, 36); if (!UUID.test(result)) invalid(field); return result }
function localDate(value: string | undefined, field: string) { if (value === undefined) return; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) bad(field) }

function message(value: unknown): SettingsMessage {
  const wire = object(value, 'message')
  exact(wire, ['id', 'title', 'content', 'type', 'pinned', 'createdByDisplayName', 'publishedAt', 'read', 'readAt'], 'message')
  if (!MESSAGE_TYPES.includes(wire.type as SettingsMessageType) || typeof wire.pinned !== 'boolean' || typeof wire.read !== 'boolean') invalid('message.state')
  const result: SettingsMessage = {
    id: uuid(wire.id, 'message.id'), title: text(wire.title, 'message.title', 160),
    content: multiline(wire.content, 'message.content', 4000), type: wire.type as SettingsMessageType,
    pinned: wire.pinned, createdByDisplayName: text(wire.createdByDisplayName, 'message.createdByDisplayName', 160),
    publishedAt: instant(wire.publishedAt, 'message.publishedAt'), read: wire.read,
    readAt: optionalInstant(wire.readAt, 'message.readAt'),
  }
  if (result.read !== Boolean(result.readAt)) invalid('message.readIdentity')
  return result
}

function page(value: unknown): SettingsMessagePage {
  const wire = object(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(message), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  if (result.size < 1 || result.size > 100 || result.items.length > result.size || result.items.length > result.totalElements || result.totalPages !== (result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size))) invalid('page.identity')
  return result
}

export const settingsMessageApi = {
  async list(input: SettingsMessageFilters & { page: number; size: number; signal?: AbortSignal }) {
    localDate(input.startDate, 'startDate'); localDate(input.endDate, 'endDate')
    if ((input.type && !MESSAGE_TYPES.includes(input.type)) || !READ_STATES.includes(input.readState) || !Number.isSafeInteger(input.page) || input.page < 0 || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 100) bad('filters')
    const query = new URLSearchParams({ readState: input.readState, page: String(input.page), size: String(input.size) })
    if (input.startDate) query.set('startDate', input.startDate)
    if (input.endDate) query.set('endDate', input.endDate)
    if (input.type) query.set('type', input.type)
    const result = page(await apiClient.request<unknown>(`${BASE}?${query}`, { signal: input.signal }))
    if (result.page !== input.page || result.size !== input.size) invalid('page.requestIdentity')
    return result
  },
  async markRead(messageIds: string[]) {
    if (!messageIds.length || messageIds.length > 100 || new Set(messageIds).size !== messageIds.length || messageIds.some((id) => !UUID.test(id))) bad('messageIds')
    const wire = object(await apiClient.request<unknown>(`${BASE}/mark-read`, { method: 'POST', body: { messageIds } }), 'markRead')
    exact(wire, ['markedRead'], 'markRead')
    return integer(wire.markedRead, 'markRead.markedRead')
  },
}
