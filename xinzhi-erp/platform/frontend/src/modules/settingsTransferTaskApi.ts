import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/settings/transfer-tasks'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TYPES = ['IMPORT', 'EXPORT'] as const
const FILTER_TYPES = ['ALL', ...TYPES] as const
const STATUSES = ['ALL', 'PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'] as const

export type SettingsTransferTaskType = typeof TYPES[number]
export type SettingsTransferTaskFilterType = typeof FILTER_TYPES[number]
export type SettingsTransferTaskStatus = typeof STATUSES[number]
export type SettingsTransferTask = {
  id: string
  jobType: SettingsTransferTaskType
  status: Exclude<SettingsTransferTaskStatus, 'ALL'>
  filename: string
  createdByDisplayName: string
  requestedCount: number
  succeededCount: number
  failedCount: number
  safeErrorSummary?: string
  resultAvailable: boolean
  resultSizeBytes: number
  createdAt: string
  completedAt?: string
}
export type SettingsTransferTaskPage = {
  items: SettingsTransferTask[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type SettingsTransferTaskFilters = {
  jobType: SettingsTransferTaskFilterType
  status: SettingsTransferTaskStatus
  startDate?: string
  endDate?: string
  keyword?: string
  resultAvailable?: boolean
}
export type SettingsTransferTaskResult = {
  filename: string
  mediaType: string
  contentBase64: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid transfer task response', { status: 502, code: 'invalid_response', details: { field } }) }
function bad(field: string): never { throw new ApiError('Invalid transfer task request', { status: 400, code: 'invalid_request', details: { field } }) }
function object(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string, maximum: number) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(field); return value }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function instant(value: unknown, field: string) { const result = text(value, field, 64); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function optionalText(value: unknown, field: string, maximum: number) { return value === null ? undefined : text(value, field, maximum) }
function optionalInstant(value: unknown, field: string) { return value === null ? undefined : instant(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field, 36); if (!UUID.test(result)) invalid(field); return result }
function localDate(value: string | undefined, field: string) { if (value === undefined) return; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) bad(field) }

function task(value: unknown): SettingsTransferTask {
  const wire = object(value, 'task')
  exact(wire, ['id', 'jobType', 'status', 'filename', 'createdByDisplayName', 'requestedCount', 'succeededCount', 'failedCount', 'safeErrorSummary', 'resultAvailable', 'resultSizeBytes', 'createdAt', 'completedAt'], 'task')
  if (!TYPES.includes(wire.jobType as SettingsTransferTaskType) || !STATUSES.slice(1).includes(wire.status as Exclude<SettingsTransferTaskStatus, 'ALL'>) || typeof wire.resultAvailable !== 'boolean') invalid('task.state')
  const result: SettingsTransferTask = {
    id: uuid(wire.id, 'task.id'), jobType: wire.jobType as SettingsTransferTaskType,
    status: wire.status as SettingsTransferTask['status'], filename: text(wire.filename, 'task.filename', 200),
    createdByDisplayName: text(wire.createdByDisplayName, 'task.createdByDisplayName', 160),
    requestedCount: integer(wire.requestedCount, 'task.requestedCount'), succeededCount: integer(wire.succeededCount, 'task.succeededCount'),
    failedCount: integer(wire.failedCount, 'task.failedCount'), safeErrorSummary: optionalText(wire.safeErrorSummary, 'task.safeErrorSummary', 500),
    resultAvailable: wire.resultAvailable, resultSizeBytes: integer(wire.resultSizeBytes, 'task.resultSizeBytes'),
    createdAt: instant(wire.createdAt, 'task.createdAt'), completedAt: optionalInstant(wire.completedAt, 'task.completedAt'),
  }
  if (result.succeededCount + result.failedCount > result.requestedCount || (result.resultAvailable && (result.jobType !== 'EXPORT' || result.status !== 'SUCCEEDED' || result.resultSizeBytes === 0)) || (!result.resultAvailable && result.resultSizeBytes !== 0)) invalid('task.identity')
  return result
}

function page(value: unknown): SettingsTransferTaskPage {
  const wire = object(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(task), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  if (result.size < 1 || result.size > 100 || result.items.length > result.size || result.items.length > result.totalElements || result.totalPages !== (result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size))) invalid('page.identity')
  return result
}

export const settingsTransferTaskApi = {
  async list(input: SettingsTransferTaskFilters & { page: number; size: number; signal?: AbortSignal }) {
    localDate(input.startDate, 'startDate'); localDate(input.endDate, 'endDate')
    if (!FILTER_TYPES.includes(input.jobType) || !STATUSES.includes(input.status) || !Number.isSafeInteger(input.page) || input.page < 0 || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 100 || (input.keyword !== undefined && (!input.keyword || input.keyword !== input.keyword.trim() || input.keyword.length > 160 || /[\u0000-\u001f\u007f]/.test(input.keyword))) || (input.resultAvailable !== undefined && typeof input.resultAvailable !== 'boolean')) bad('filters')
    const query = new URLSearchParams({ jobType: input.jobType, status: input.status, page: String(input.page), size: String(input.size) })
    if (input.startDate) query.set('startDate', input.startDate)
    if (input.endDate) query.set('endDate', input.endDate)
    if (input.keyword) query.set('keyword', input.keyword)
    if (input.resultAvailable !== undefined) query.set('resultAvailable', String(input.resultAvailable))
    const result = page(await apiClient.request<unknown>(`${BASE}?${query}`, { signal: input.signal }))
    if (result.page !== input.page || result.size !== input.size || result.items.some((item) => (input.jobType !== 'ALL' && item.jobType !== input.jobType) || (input.resultAvailable !== undefined && item.resultAvailable !== input.resultAvailable))) invalid('page.requestIdentity')
    return result
  },
  async result(taskId: string): Promise<SettingsTransferTaskResult> {
    if (!UUID.test(taskId)) bad('taskId')
    const wire = object(await apiClient.request<unknown>(`${BASE}/${taskId}/result`), 'result')
    exact(wire, ['filename', 'mediaType', 'contentBase64'], 'result')
    const contentBase64 = text(wire.contentBase64, 'result.contentBase64', 24_000_000)
    if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) invalid('result.contentBase64')
    return { filename: text(wire.filename, 'result.filename', 200), mediaType: text(wire.mediaType, 'result.mediaType', 100), contentBase64 }
  },
}
