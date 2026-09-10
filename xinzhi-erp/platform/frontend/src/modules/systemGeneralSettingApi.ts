import { ApiError, apiClient } from '../api/client'

const API_PATH = '/api/v1/settings/system-general'

export type SystemGeneralSetting = {
  configured: boolean
  defaultCurrency: string
  orderPullBlackoutStart?: string
  orderPullBlackoutEnd?: string
  version: number
  updatedByDisplayName?: string
  createdAt?: string
  updatedAt?: string
}

export type SystemGeneralSettingInput = {
  defaultCurrency: string
  orderPullBlackoutStart?: string
  orderPullBlackoutEnd?: string
}

const FIELDS = [
  'configured', 'defaultCurrency', 'orderPullBlackoutStart',
  'orderPullBlackoutEnd', 'version', 'updatedByDisplayName',
  'createdAt', 'updatedAt',
] as const
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function invalid(field: string): never {
  throw new ApiError('Invalid system settings response', {
    status: 502, code: 'invalid_response', details: { field },
  })
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(field)
  return value
}

function parse(value: unknown): SystemGeneralSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('setting')
  const wire = value as Record<string, unknown>
  if (Object.keys(wire).some((field) => !FIELDS.includes(field as typeof FIELDS[number]))
    || FIELDS.some((field) => !(field in wire))
    || typeof wire.configured !== 'boolean'
    || typeof wire.defaultCurrency !== 'string'
    || !/^[A-Z]{3}$/.test(wire.defaultCurrency)
    || typeof wire.version !== 'number' || !Number.isSafeInteger(wire.version)
    || wire.version < 0) invalid('setting.shape')
  const start = wire.orderPullBlackoutStart
  const end = wire.orderPullBlackoutEnd
  if ((start == null) !== (end == null)
    || (start != null && (typeof start !== 'string' || !TIME.test(start)))
    || (end != null && (typeof end !== 'string' || !TIME.test(end)))
    || (start != null && start === end)) invalid('setting.blackout')
  if (!wire.configured) {
    if (wire.version !== 0 || wire.updatedByDisplayName != null
      || wire.createdAt != null || wire.updatedAt != null
      || start != null || end != null) invalid('setting.unconfigured')
    return { configured: false, defaultCurrency: wire.defaultCurrency, version: 0 }
  }
  if (typeof wire.updatedByDisplayName !== 'string'
    || !wire.updatedByDisplayName.trim()
    || wire.updatedByDisplayName !== wire.updatedByDisplayName.trim()
    || wire.updatedByDisplayName.length > 160) invalid('setting.updatedByDisplayName')
  return {
    configured: true,
    defaultCurrency: wire.defaultCurrency,
    orderPullBlackoutStart: start as string | undefined,
    orderPullBlackoutEnd: end as string | undefined,
    version: wire.version,
    updatedByDisplayName: wire.updatedByDisplayName,
    createdAt: timestamp(wire.createdAt, 'setting.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'setting.updatedAt'),
  }
}

function validate(expectedVersion: number, input: SystemGeneralSettingInput) {
  const start = input.orderPullBlackoutStart
  const end = input.orderPullBlackoutEnd
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || !/^[A-Z]{3}$/.test(input.defaultCurrency)
    || (start == null) !== (end == null)
    || (start != null && (!TIME.test(start) || start === end))
    || (end != null && !TIME.test(end))) {
    throw new ApiError('Invalid system settings request', {
      status: 400, code: 'invalid_request',
    })
  }
}

export const systemGeneralSettingApi = {
  async get(signal?: AbortSignal): Promise<SystemGeneralSetting> {
    return parse(await apiClient.request<unknown>(API_PATH, { signal }))
  },
  async save(expectedVersion: number, input: SystemGeneralSettingInput) {
    validate(expectedVersion, input)
    return parse(await apiClient.request<unknown>(API_PATH, {
      method: 'PUT', body: { expectedVersion, ...input,
        orderPullBlackoutStart: input.orderPullBlackoutStart ?? null,
        orderPullBlackoutEnd: input.orderPullBlackoutEnd ?? null,
      },
    }))
  },
}
