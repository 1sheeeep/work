import { ApiError, apiClient } from '../api/client'

const API_PATH = '/api/v1/settings/enterprise-branding'
export const ENTERPRISE_BRANDING_CHANGED = 'xz-erp.enterprise-branding-changed'

export type EnterpriseBranding = {
  configured: boolean
  watermarkEnabled: boolean
  watermarkUserName: boolean
  watermarkCompanyName: boolean
  watermarkTime: boolean
  watermarkPhoneSuffix: boolean
  version: number
  updatedByDisplayName?: string
  updatedAt?: string
}

export type EnterpriseBrandingInput = Pick<EnterpriseBranding,
  'watermarkEnabled' | 'watermarkUserName' | 'watermarkCompanyName'
  | 'watermarkTime' | 'watermarkPhoneSuffix'>

const FIELDS = [
  'configured', 'watermarkEnabled',
  'watermarkUserName', 'watermarkCompanyName', 'watermarkTime',
  'watermarkPhoneSuffix', 'version', 'updatedByDisplayName', 'updatedAt',
] as const

function invalid(field: string): never {
  throw new ApiError('Invalid enterprise branding response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function parse(value: unknown): EnterpriseBranding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('branding')
  const wire = value as Record<string, unknown>
  if (Object.keys(wire).some((field) => !FIELDS.includes(field as typeof FIELDS[number]))
    || FIELDS.some((field) => !(field in wire))) invalid('branding.shape')
  const booleans = [
    'configured', 'watermarkEnabled', 'watermarkUserName',
    'watermarkCompanyName', 'watermarkTime', 'watermarkPhoneSuffix',
  ] as const
  if (booleans.some((field) => typeof wire[field] !== 'boolean')
    || !Number.isSafeInteger(wire.version) || Number(wire.version) < 0) {
    invalid('branding.values')
  }
  const optionalText = (field: 'updatedByDisplayName' | 'updatedAt') => {
    const item = wire[field]
    if (item == null) return undefined
    if (typeof item !== 'string' || !item.trim() || item.length > 160) invalid(`branding.${field}`)
    return item
  }
  const updatedAt = optionalText('updatedAt')
  if (updatedAt && Number.isNaN(Date.parse(updatedAt))) invalid('branding.updatedAt')
  return {
    configured: wire.configured as boolean,
    watermarkEnabled: wire.watermarkEnabled as boolean,
    watermarkUserName: wire.watermarkUserName as boolean,
    watermarkCompanyName: wire.watermarkCompanyName as boolean,
    watermarkTime: wire.watermarkTime as boolean,
    watermarkPhoneSuffix: wire.watermarkPhoneSuffix as boolean,
    version: Number(wire.version),
    updatedByDisplayName: optionalText('updatedByDisplayName'),
    updatedAt,
  }
}

function requestId() {
  return `settings-branding.${crypto.randomUUID()}`
}

function validateVersion(version: number) {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new ApiError('Invalid enterprise branding request', {
      status: 400,
      code: 'invalid_request',
    })
  }
}

export function notifyEnterpriseBrandingChanged() {
  window.dispatchEvent(new Event(ENTERPRISE_BRANDING_CHANGED))
}

export const enterpriseBrandingApi = {
  async get(signal?: AbortSignal) {
    return parse(await apiClient.request<unknown>(API_PATH, { signal }))
  },
  async save(expectedVersion: number, input: EnterpriseBrandingInput) {
    validateVersion(expectedVersion)
    if (input.watermarkEnabled && !input.watermarkUserName
      && !input.watermarkCompanyName && !input.watermarkTime
      && !input.watermarkPhoneSuffix) {
      throw new ApiError('Select at least one watermark element', {
        status: 400,
        code: 'invalid_request',
      })
    }
    return parse(await apiClient.request<unknown>(API_PATH, {
      method: 'PUT',
      body: { expectedVersion, ...input },
      headers: { 'X-Request-Id': requestId() },
    }))
  },
}
