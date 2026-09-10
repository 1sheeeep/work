import { apiClient, ApiError } from '../api/client'

const BASE = '/api/v1/settings/order-exception-categories'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type OrderExceptionCategory = {
  id: string
  name: string
  handlingGuidance?: string
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type OrderExceptionCategorySet = {
  configured: boolean
  revision: number
  updatedByDisplayName?: string
  createdAt?: string
  updatedAt?: string
  items: OrderExceptionCategory[]
}

export type OrderExceptionCategoryInput = {
  id?: string
  name: string
  handlingGuidance?: string
  enabled: boolean
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('Invalid order exception category response', {
      status: 502, code: 'invalid_response',
    })
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, required = true) {
  if (value == null && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new ApiError(`Invalid ${field}`, { status: 502, code: 'invalid_response' })
  }
  return value
}

function integer(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ApiError(`Invalid ${field}`, { status: 502, code: 'invalid_response' })
  }
  return Number(value)
}

function parseItem(value: unknown): OrderExceptionCategory {
  const source = object(value)
  const id = text(source.id, 'category id')!
  if (!UUID.test(id) || typeof source.enabled !== 'boolean') {
    throw new ApiError('Invalid order exception category', {
      status: 502, code: 'invalid_response',
    })
  }
  return {
    id,
    name: text(source.name, 'category name')!,
    handlingGuidance: text(source.handlingGuidance, 'handling guidance', false),
    enabled: source.enabled,
    sortOrder: integer(source.sortOrder, 'sort order'),
    createdAt: text(source.createdAt, 'created time')!,
    updatedAt: text(source.updatedAt, 'updated time')!,
  }
}

function parseSet(value: unknown): OrderExceptionCategorySet {
  const source = object(value)
  if (typeof source.configured !== 'boolean' || !Array.isArray(source.items)) {
    throw new ApiError('Invalid order exception category set', {
      status: 502, code: 'invalid_response',
    })
  }
  return {
    configured: source.configured,
    revision: integer(source.revision, 'revision'),
    updatedByDisplayName: text(source.updatedByDisplayName, 'operator', false),
    createdAt: text(source.createdAt, 'created time', false),
    updatedAt: text(source.updatedAt, 'updated time', false),
    items: source.items.map(parseItem),
  }
}

function normalize(items: OrderExceptionCategoryInput[]) {
  if (items.length > 50) {
    throw new ApiError('Too many order exception categories', {
      status: 400, code: 'invalid_request',
    })
  }
  return items.map((item) => {
    const name = item.name.trim()
    const handlingGuidance = item.handlingGuidance?.trim() || undefined
    if ((item.id && !UUID.test(item.id)) || !name || name.length > 80
      || (handlingGuidance?.length ?? 0) > 240) {
      throw new ApiError('Invalid order exception category', {
        status: 400, code: 'invalid_request',
      })
    }
    return { id: item.id, name, handlingGuidance, enabled: item.enabled }
  })
}

export const orderExceptionCategoryApi = {
  async get(signal?: AbortSignal) {
    return parseSet(await apiClient.request<unknown>(BASE, { signal }))
  },
  async save(expectedRevision: number, items: OrderExceptionCategoryInput[]) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ApiError('Invalid order exception category revision', {
        status: 400, code: 'invalid_request',
      })
    }
    return parseSet(await apiClient.request<unknown>(BASE, {
      method: 'PUT',
      body: { expectedRevision, items: normalize(items) },
      headers: { 'X-Request-Id': `settings-order-exception.${crypto.randomUUID()}` },
    }))
  },
}
