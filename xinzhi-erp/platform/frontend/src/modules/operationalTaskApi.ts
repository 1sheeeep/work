import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/settings/tasks'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const OPERATIONAL_TASK_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'DELETED',
] as const
export const OPERATIONAL_TASK_URGENCIES = ['NORMAL', 'URGENT'] as const
export type OperationalTaskStatus = typeof OPERATIONAL_TASK_STATUSES[number]
export type OperationalTaskUrgency = typeof OPERATIONAL_TASK_URGENCIES[number]
export type OperationalTaskSearchBy = 'TITLE' | 'ASSIGNEE' | 'OBJECT' | 'TASK_NO'

export type OperationalTask = {
  id: string
  taskNo: string
  title: string
  category: string
  taskObject: string
  urgency: OperationalTaskUrgency
  assigneeName: string
  description?: string
  status: OperationalTaskStatus
  completedAt?: string
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type OperationalTaskPage = {
  items: OperationalTask[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type OperationalTaskFilters = {
  searchBy: OperationalTaskSearchBy
  keyword?: string
  startDate?: string
  endDate?: string
  status?: OperationalTaskStatus
  urgency?: OperationalTaskUrgency
}
export type OperationalTaskInput = {
  title: string
  category: string
  taskObject: string
  urgency: OperationalTaskUrgency
  assigneeName: string
  description?: string
}
export type OperationalTaskExport = {
  filename: 'operational-tasks.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid operational task response', { status: 502, code: 'invalid_response', details: { field } }) }
function bad(field: string): never { throw new ApiError('Invalid operational task request', { status: 400, code: 'invalid_request', details: { field } }) }
function object(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string, maximum = 1000) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(field); return value }
function optionalText(value: unknown, field: string, maximum = 1000) { return value === null ? undefined : text(value, field, maximum) }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function instant(value: unknown, field: string) { const result = text(value, field, 64); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function optionalInstant(value: unknown, field: string) { return value === null ? undefined : instant(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field, 36); if (!UUID.test(result)) invalid(field); return result }
function status(value: unknown): OperationalTaskStatus { if (!OPERATIONAL_TASK_STATUSES.includes(value as OperationalTaskStatus)) invalid('task.status'); return value as OperationalTaskStatus }
function urgency(value: unknown): OperationalTaskUrgency { if (!OPERATIONAL_TASK_URGENCIES.includes(value as OperationalTaskUrgency)) invalid('task.urgency'); return value as OperationalTaskUrgency }

function task(value: unknown): OperationalTask {
  const wire = object(value, 'task')
  exact(wire, ['id', 'taskNo', 'title', 'category', 'taskObject', 'urgency', 'assigneeName', 'description', 'status', 'completedAt', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'], 'task')
  const result: OperationalTask = {
    id: uuid(wire.id, 'task.id'), taskNo: text(wire.taskNo, 'task.taskNo', 40),
    title: text(wire.title, 'task.title', 160), category: text(wire.category, 'task.category', 80),
    taskObject: text(wire.taskObject, 'task.taskObject', 160), urgency: urgency(wire.urgency),
    assigneeName: text(wire.assigneeName, 'task.assigneeName', 160), description: optionalText(wire.description, 'task.description'),
    status: status(wire.status), completedAt: optionalInstant(wire.completedAt, 'task.completedAt'),
    createdByDisplayName: text(wire.createdByDisplayName, 'task.createdByDisplayName', 160),
    version: integer(wire.version, 'task.version'), createdAt: instant(wire.createdAt, 'task.createdAt'), updatedAt: instant(wire.updatedAt, 'task.updatedAt'),
  }
  if ((result.status === 'COMPLETED') !== Boolean(result.completedAt)) invalid('task.lifecycle')
  return result
}
function page(value: unknown): OperationalTaskPage {
  const wire = object(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(task), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  if (result.size < 1 || result.size > 100 || result.items.length > result.size || result.items.length > result.totalElements || result.totalPages !== (result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size))) invalid('page.identity')
  return result
}
function exported(value: unknown): OperationalTaskExport {
  const wire = object(value, 'export'); exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const rowCount = integer(wire.rowCount, 'export.rowCount'); const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (wire.filename !== 'operational-tasks.csv' || wire.mediaType !== 'text/csv;charset=utf-8' || rowCount > 10_000 || content.length > 30_000_000 || !content.startsWith('\uFEFF\"任务编号\",\"任务标题\",')) invalid('export.contract')
  return { filename: 'operational-tasks.csv', mediaType: 'text/csv;charset=utf-8', rowCount, content }
}

function date(value?: string) { if (!value) return undefined; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('date'); return value }
function filtersQuery(input: OperationalTaskFilters) {
  const query = new URLSearchParams({ searchBy: input.searchBy })
  if (input.keyword?.trim()) query.set('keyword', input.keyword.trim().slice(0, 500))
  if (date(input.startDate)) query.set('startDate', input.startDate!)
  if (date(input.endDate)) query.set('endDate', input.endDate!)
  if (input.status) query.set('status', input.status)
  if (input.urgency) query.set('urgency', input.urgency)
  return query
}
function validateInput(input: OperationalTaskInput) {
  const required = [input.title, input.category, input.taskObject, input.assigneeName]
  if (required.some((value) => !value.trim()) || input.title.trim().length > 160 || input.category.trim().length > 80 || input.taskObject.trim().length > 160 || input.assigneeName.trim().length > 160 || (input.description?.trim().length ?? 0) > 1000 || !OPERATIONAL_TASK_URGENCIES.includes(input.urgency)) bad('task')
}
function normalized(input: OperationalTaskInput): OperationalTaskInput { return { title: input.title.trim(), category: input.category.trim(), taskObject: input.taskObject.trim(), urgency: input.urgency, assigneeName: input.assigneeName.trim(), description: input.description?.trim() || undefined } }
function requestId() { return `settings-task.${crypto.randomUUID()}` }

export const operationalTaskApi = {
  async list(input: OperationalTaskFilters & { page: number; size: number; signal?: AbortSignal }) {
    if (!Number.isSafeInteger(input.page) || input.page < 0 || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 100) bad('page')
    const query = filtersQuery(input); query.set('page', String(input.page)); query.set('size', String(input.size))
    const result = page(await apiClient.request<unknown>(`${BASE}?${query}`, { signal: input.signal }))
    if (result.page !== input.page || result.size !== input.size) invalid('page.requestIdentity')
    return result
  },
  async create(input: OperationalTaskInput) { validateInput(input); return task(await apiClient.request<unknown>(BASE, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: normalized(input) })) },
  async transition(id: string, version: number, next: OperationalTaskStatus) { if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 0 || !OPERATIONAL_TASK_STATUSES.includes(next)) bad('transition'); return task(await apiClient.request<unknown>(`${BASE}/${id}/status`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version, status: next } })) },
  async completeBatch(tasks: Array<Pick<OperationalTask, 'id' | 'version'>>) { if (!tasks.length || tasks.length > 100 || new Set(tasks.map((item) => item.id)).size !== tasks.length || tasks.some((item) => !UUID.test(item.id) || !Number.isSafeInteger(item.version) || item.version < 0)) bad('batch'); const wire = await apiClient.request<unknown>(`${BASE}/batch-complete`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { tasks } }); if (!Array.isArray(wire)) invalid('batch'); return wire.map(task) },
  async exportCsv(input: OperationalTaskFilters) { return exported(await apiClient.request<unknown>(`${BASE}/exports`, { method: 'POST', body: Object.fromEntries(filtersQuery(input)) })) },
}
