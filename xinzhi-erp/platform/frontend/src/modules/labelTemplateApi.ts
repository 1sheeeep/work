import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/label-templates'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LabelTemplateScope = 'STANDARD' | 'CUSTOM'
export type LabelTemplate = {
  id: string
  scope: LabelTemplateScope
  name: string
  documentCategory: string
  widthMm: number
  heightMm: number
  content: string
  note?: string
  status: 'ACTIVE' | 'ARCHIVED'
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type LabelTemplatePage = {
  items: LabelTemplate[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type LabelTemplateInput = {
  name: string
  documentCategory: string
  widthMm: number
  heightMm: number
  content: string
  note?: string
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid label template response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function record(value: unknown, field: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Wire
}

function exact(value: Wire, fields: readonly string[], field: string) {
  if (Object.keys(value).some((key) => !fields.includes(key))
    || fields.some((key) => !(key in value))) invalid(`${field}.shape`)
}

function text(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) invalid(field)
  return value
}

function optional(value: unknown, field: string) {
  return value === null ? undefined : text(value, field)
}

function uuid(value: unknown, field: string) {
  const parsed = text(value, field)
  if (!UUID.test(parsed)) invalid(field)
  return parsed
}

function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field)
  return value
}

function time(value: unknown, field: string) {
  const parsed = text(value, field)
  if (Number.isNaN(Date.parse(parsed))) invalid(field)
  return parsed
}

const fields = [
  'id', 'scope', 'name', 'documentCategory', 'widthMm', 'heightMm',
  'content', 'note', 'status', 'createdByDisplayName', 'version',
  'createdAt', 'updatedAt',
] as const

function template(value: unknown): LabelTemplate {
  const wire = record(value, 'template')
  exact(wire, fields, 'template')
  if (wire.scope !== 'STANDARD' && wire.scope !== 'CUSTOM') invalid('template.scope')
  if (wire.status !== 'ACTIVE' && wire.status !== 'ARCHIVED') invalid('template.status')
  const widthMm = integer(wire.widthMm, 'template.widthMm')
  const heightMm = integer(wire.heightMm, 'template.heightMm')
  if (widthMm < 20 || widthMm > 300 || heightMm < 20 || heightMm > 300) {
    invalid('template.dimensions')
  }
  return {
    id: uuid(wire.id, 'template.id'),
    scope: wire.scope,
    name: text(wire.name, 'template.name'),
    documentCategory: text(wire.documentCategory, 'template.documentCategory'),
    widthMm,
    heightMm,
    content: text(wire.content, 'template.content'),
    note: optional(wire.note, 'template.note'),
    status: wire.status,
    createdByDisplayName: text(wire.createdByDisplayName, 'template.createdByDisplayName'),
    version: integer(wire.version, 'template.version'),
    createdAt: time(wire.createdAt, 'template.createdAt'),
    updatedAt: time(wire.updatedAt, 'template.updatedAt'),
  }
}

function page(value: unknown): LabelTemplatePage {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = {
    items: wire.items.map(template),
    page: integer(wire.page, 'page.page'),
    size: integer(wire.size, 'page.size'),
    totalElements: integer(wire.totalElements, 'page.totalElements'),
    totalPages: integer(wire.totalPages, 'page.totalPages'),
  }
  if (result.size < 1 || result.items.length > result.size) invalid('page.size')
  return result
}

function requestId() {
  return `label-template.${crypto.randomUUID()}`
}

export const labelTemplateApi = {
  async list(input: {
    scope: LabelTemplateScope
    documentCategory?: string
    size?: string
    keyword?: string
    page: number
    pageSize: number
    signal?: AbortSignal
  }) {
    const params = new URLSearchParams({
      scope: input.scope,
      page: String(input.page),
      pageSize: String(input.pageSize),
    })
    if (input.documentCategory?.trim()) params.set('documentCategory', input.documentCategory.trim())
    if (input.size?.trim()) params.set('size', input.size.trim())
    if (input.keyword?.trim()) params.set('keyword', input.keyword.trim())
    return page(await apiClient.request<unknown>(`${API_BASE}?${params}`, { signal: input.signal }))
  },
  async create(input: LabelTemplateInput) {
    return template(await apiClient.request<unknown>(API_BASE, {
      method: 'POST',
      headers: { 'X-Request-Id': requestId() },
      body: input,
    }))
  },
  async archive(id: string, version: number) {
    return template(await apiClient.request<unknown>(`${API_BASE}/${id}/archive`, {
      method: 'POST',
      headers: { 'X-Request-Id': requestId() },
      body: { version },
    }))
  },
}
