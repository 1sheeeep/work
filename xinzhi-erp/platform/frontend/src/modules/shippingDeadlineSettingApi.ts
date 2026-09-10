import { ApiError, apiClient } from '../api/client'

const API_PATH = '/api/v1/settings/order-shipping-deadline'

export type ShippingDeadlineSetting = {
  configured: boolean
  deadlineDays: number
  version: number
  updatedByDisplayName?: string
  createdAt?: string
  updatedAt?: string
}

const FIELDS = [
  'configured', 'deadlineDays', 'version', 'updatedByDisplayName',
  'createdAt', 'updatedAt',
] as const

function invalid(field: string): never {
  throw new ApiError('Invalid shipping deadline response', {
    status: 502, code: 'invalid_response', details: { field },
  })
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(field)
  return value
}

function parse(value: unknown): ShippingDeadlineSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('setting')
  const wire = value as Record<string, unknown>
  if (Object.keys(wire).some((field) => !FIELDS.includes(field as typeof FIELDS[number]))
    || FIELDS.some((field) => !(field in wire))
    || typeof wire.configured !== 'boolean'
    || typeof wire.deadlineDays !== 'number'
    || !Number.isSafeInteger(wire.deadlineDays)
    || wire.deadlineDays < 1 || wire.deadlineDays > 365
    || typeof wire.version !== 'number' || !Number.isSafeInteger(wire.version)
    || wire.version < 0) invalid('setting.shape')
  if (!wire.configured) {
    if (wire.version !== 0 || wire.updatedByDisplayName != null
      || wire.createdAt != null || wire.updatedAt != null) invalid('setting.unconfigured')
    return { configured: false, deadlineDays: wire.deadlineDays, version: 0 }
  }
  if (typeof wire.updatedByDisplayName !== 'string'
    || !wire.updatedByDisplayName.trim()
    || wire.updatedByDisplayName !== wire.updatedByDisplayName.trim()
    || wire.updatedByDisplayName.length > 160) invalid('setting.updatedByDisplayName')
  return {
    configured: true,
    deadlineDays: wire.deadlineDays,
    version: wire.version,
    updatedByDisplayName: wire.updatedByDisplayName,
    createdAt: timestamp(wire.createdAt, 'setting.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'setting.updatedAt'),
  }
}

function validate(expectedVersion: number, deadlineDays: number) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || !Number.isSafeInteger(deadlineDays)
    || deadlineDays < 1 || deadlineDays > 365) {
    throw new ApiError('Invalid shipping deadline request', {
      status: 400, code: 'invalid_request',
    })
  }
}

export const shippingDeadlineSettingApi = {
  async get(signal?: AbortSignal): Promise<ShippingDeadlineSetting> {
    return parse(await apiClient.request<unknown>(API_PATH, { signal }))
  },
  async save(expectedVersion: number, deadlineDays: number) {
    validate(expectedVersion, deadlineDays)
    return parse(await apiClient.request<unknown>(API_PATH, {
      method: 'PUT', body: { expectedVersion, deadlineDays },
    }))
  },
}
