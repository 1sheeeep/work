import { ApiError, apiClient } from '../api/client'

const API_PATH = '/api/v1/settings/enterprise-profile'

export type EnterpriseProfileInput = {
  companyName: string
  province?: string
  city?: string
  district?: string
  detailedAddress?: string
  contactName: string
  contactEmail: string
  contactQq?: string
  contactMobile: string
  contactTelephone?: string
}

export type EnterpriseProfile = {
  tenantCode: string
  tenantName: string
  configured: boolean
  companyName?: string
  province?: string
  city?: string
  district?: string
  detailedAddress?: string
  contactName?: string
  contactEmail?: string
  contactQq?: string
  contactMobile?: string
  contactTelephone?: string
  version: number
  createdAt?: string
  updatedAt?: string
}

type Wire = Record<string, unknown>
const FIELDS = [
  'tenantCode', 'tenantName', 'configured', 'companyName', 'province', 'city',
  'district', 'detailedAddress', 'contactName', 'contactEmail', 'contactQq',
  'contactMobile', 'contactTelephone', 'version', 'createdAt', 'updatedAt',
] as const

function invalid(field: string): never {
  throw new ApiError('Invalid enterprise profile response', {
    status: 502, code: 'invalid_response', details: { field },
  })
}
function record(value: unknown): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('profile')
  const wire = value as Wire
  if (Object.keys(wire).some((field) => !FIELDS.includes(field as typeof FIELDS[number]))
    || FIELDS.some((field) => !(field in wire))) invalid('profile.shape')
  return wire
}
function text(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(field)
  return value
}
function optionalText(value: unknown, field: string, maximum: number) {
  return value == null ? undefined : text(value, field, maximum)
}
function timestamp(value: unknown, field: string) {
  const result = text(value, field, 64)
  if (Number.isNaN(Date.parse(result))) invalid(field)
  return result
}
function parse(value: unknown): EnterpriseProfile {
  const wire = record(value)
  if (typeof wire.configured !== 'boolean') invalid('profile.configured')
  if (typeof wire.version !== 'number' || !Number.isSafeInteger(wire.version)
    || wire.version < 0) invalid('profile.version')
  const base = {
    tenantCode: text(wire.tenantCode, 'profile.tenantCode', 64),
    tenantName: text(wire.tenantName, 'profile.tenantName', 160),
    configured: wire.configured,
    version: wire.version,
  }
  if (!wire.configured) {
    const optionalFields = FIELDS.filter((field) => ![
      'tenantCode', 'tenantName', 'configured', 'version',
    ].includes(field))
    if (wire.version !== 0 || optionalFields.some((field) => wire[field] != null)) {
      invalid('profile.unconfigured')
    }
    return base
  }
  const contactEmail = text(wire.contactEmail, 'profile.contactEmail', 254)
  const contactMobile = text(wire.contactMobile, 'profile.contactMobile', 32)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
    || !/^[+()0-9 .-]{6,32}$/.test(contactMobile)) invalid('profile.contact')
  const contactQq = optionalText(wire.contactQq, 'profile.contactQq', 20)
  const contactTelephone = optionalText(
    wire.contactTelephone, 'profile.contactTelephone', 32,
  )
  if ((contactQq && !/^\d{5,20}$/.test(contactQq))
    || (contactTelephone && !/^[+()0-9 .-]{6,32}$/.test(contactTelephone))) {
    invalid('profile.contact')
  }
  return {
    ...base,
    companyName: text(wire.companyName, 'profile.companyName', 160),
    province: optionalText(wire.province, 'profile.province', 100),
    city: optionalText(wire.city, 'profile.city', 100),
    district: optionalText(wire.district, 'profile.district', 100),
    detailedAddress: optionalText(wire.detailedAddress, 'profile.detailedAddress', 500),
    contactName: text(wire.contactName, 'profile.contactName', 160),
    contactEmail, contactQq, contactMobile, contactTelephone,
    createdAt: timestamp(wire.createdAt, 'profile.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'profile.updatedAt'),
  }
}

function validate(input: EnterpriseProfileInput, expectedVersion: number) {
  const required = [input.companyName, input.contactName, input.contactEmail, input.contactMobile]
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || required.some((value) => !value.trim())
    || input.companyName.trim().length > 160 || input.contactName.trim().length > 160
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim())
    || !/^[+()0-9 .-]{6,32}$/.test(input.contactMobile.trim())
    || (input.contactQq?.trim() && !/^\d{5,20}$/.test(input.contactQq.trim()))
    || (input.contactTelephone?.trim()
      && !/^[+()0-9 .-]{6,32}$/.test(input.contactTelephone.trim()))) {
    throw new ApiError('Invalid enterprise profile request', {
      status: 400, code: 'invalid_request',
    })
  }
}

function normalized(input: EnterpriseProfileInput): EnterpriseProfileInput {
  const optional = (value?: string) => value?.trim() || undefined
  return {
    companyName: input.companyName.trim(),
    province: optional(input.province), city: optional(input.city),
    district: optional(input.district), detailedAddress: optional(input.detailedAddress),
    contactName: input.contactName.trim(),
    contactEmail: input.contactEmail.trim().toLowerCase(),
    contactQq: optional(input.contactQq),
    contactMobile: input.contactMobile.trim(),
    contactTelephone: optional(input.contactTelephone),
  }
}

export const enterpriseProfileApi = {
  async get(signal?: AbortSignal): Promise<EnterpriseProfile> {
    return parse(await apiClient.request<unknown>(API_PATH, { signal }))
  },
  async save(expectedVersion: number, input: EnterpriseProfileInput) {
    validate(input, expectedVersion)
    return parse(await apiClient.request<unknown>(API_PATH, {
      method: 'PUT', body: { expectedVersion, profile: normalized(input) },
    }))
  },
}
