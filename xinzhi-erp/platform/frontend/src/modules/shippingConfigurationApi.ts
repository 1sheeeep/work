import { apiClient } from '../api/client'

const API_BASE = '/api/v1/shipping-configuration'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PackagingType = 'BOX' | 'MAILER' | 'BAG' | 'OTHER'
export type PackagingStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
export type ScaleStatus = 'ACTIVE' | 'INACTIVE'

export type PackagingTemplate = {
  id: string
  businessCode: string
  name: string
  packagingType: PackagingType
  standardWeightGrams: number
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  status: PackagingStatus
  version: number
  updatedAt: string
}

export type WarehousePackaging = {
  template: PackagingTemplate
  enabled: boolean
}

export type PackagingRuleStatus = 'ACTIVE' | 'INACTIVE'

export type PackagingRule = {
  id: string
  skuId: string
  minQuantity: number
  maxQuantity: number
  packagingTemplateId: string
  packagingCode: string
  packagingName: string
  status: PackagingRuleStatus
  version: number
  updatedAt: string
}

export type ShippingScale = {
  id: string
  warehouseId: string
  deviceNumber: string
  displayName: string
  status: ScaleStatus
  version: number
  updatedAt: string
}

export type WeightTolerance = {
  toleranceGrams: number
  toleranceBasisPoints: number
  warehouseOverride: boolean
}

export type CreatePackagingTemplateInput = {
  businessCode: string
  name: string
  packagingType: PackagingType
  standardWeightGrams: number
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
}

export type UpdatePackagingTemplateInput = Omit<
  CreatePackagingTemplateInput,
  'businessCode'
> & {
  status: PackagingStatus
  version: number
}

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`Invalid shipping configuration response: ${field}`)
}

function invalidRequest(field: string): never {
  throw new Error(`Invalid shipping configuration request: ${field}`)
}

function asRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(field)
  }
  return value as UnknownRecord
}

function string(value: unknown, field: string) {
  return typeof value === 'string' && value.length > 0
    ? value
    : invalid(field)
}

function uuid(value: unknown, field: string) {
  const parsed = string(value, field)
  return UUID_PATTERN.test(parsed) ? parsed : invalid(field)
}

function integer(value: unknown, field: string, minimum = 0) {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : invalid(field)
}

function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  const parsed = integer(value, field, minimum)
  return parsed <= maximum ? parsed : invalid(field)
}

function optionalInteger(value: unknown, field: string) {
  return value === null
    ? null
    : boundedInteger(value, field, 1, 999_999)
}

function timestamp(value: unknown, field: string) {
  const parsed = string(value, field)
  return Number.isNaN(Date.parse(parsed)) ? invalid(field) : parsed
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): T {
  return typeof value === 'string' && options.includes(value as T)
    ? (value as T)
    : invalid(field)
}

function mapTemplate(value: unknown): PackagingTemplate {
  const wire = asRecord(value, 'template')
  const lengthMm = optionalInteger(wire.lengthMm, 'template.lengthMm')
  const widthMm = optionalInteger(wire.widthMm, 'template.widthMm')
  const heightMm = optionalInteger(wire.heightMm, 'template.heightMm')
  if (
    [lengthMm, widthMm, heightMm].filter((item) => item !== null).length !==
    (lengthMm === null ? 0 : 3)
  ) {
    return invalid('template.dimensions')
  }
  return {
    id: uuid(wire.id, 'template.id'),
    businessCode: string(wire.businessCode, 'template.businessCode'),
    name: string(wire.name, 'template.name'),
    packagingType: oneOf(
      wire.packagingType,
      ['BOX', 'MAILER', 'BAG', 'OTHER'] as const,
      'template.packagingType',
    ),
    standardWeightGrams: boundedInteger(
      wire.standardWeightGrams,
      'template.standardWeightGrams',
      1,
      999_999_999,
    ),
    lengthMm,
    widthMm,
    heightMm,
    status: oneOf(
      wire.status,
      ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const,
      'template.status',
    ),
    version: integer(wire.version, 'template.version'),
    updatedAt: timestamp(wire.updatedAt, 'template.updatedAt'),
  }
}

function mapList(value: unknown, field: string) {
  const wire = asRecord(value, field)
  return Array.isArray(wire.items) ? wire.items : invalid(`${field}.items`)
}

function mapWarehousePackagingList(value: unknown): WarehousePackaging[] {
  return mapList(value, 'warehousePackagingList').map((item) => {
    const wire = asRecord(item, 'warehousePackaging')
    if (typeof wire.enabled !== 'boolean') {
      return invalid('warehousePackaging.enabled')
    }
    return { template: mapTemplate(wire.template), enabled: wire.enabled }
  })
}

function mapRule(value: unknown, expectedSkuId: string): PackagingRule {
  const wire = asRecord(value, 'packagingRule')
  const skuId = uuid(wire.skuId, 'packagingRule.skuId')
  if (skuId.toLowerCase() !== expectedSkuId.toLowerCase()) {
    return invalid('packagingRule.skuId')
  }
  const minQuantity = boundedInteger(
    wire.minQuantity,
    'packagingRule.minQuantity',
    1,
    999_999,
  )
  const maxQuantity = boundedInteger(
    wire.maxQuantity,
    'packagingRule.maxQuantity',
    1,
    999_999,
  )
  if (maxQuantity < minQuantity) return invalid('packagingRule.quantityRange')
  return {
    id: uuid(wire.id, 'packagingRule.id'),
    skuId,
    minQuantity,
    maxQuantity,
    packagingTemplateId: uuid(
      wire.packagingTemplateId,
      'packagingRule.packagingTemplateId',
    ),
    packagingCode: string(wire.packagingCode, 'packagingRule.packagingCode'),
    packagingName: string(wire.packagingName, 'packagingRule.packagingName'),
    status: oneOf(
      wire.status,
      ['ACTIVE', 'INACTIVE'] as const,
      'packagingRule.status',
    ),
    version: integer(wire.version, 'packagingRule.version'),
    updatedAt: timestamp(wire.updatedAt, 'packagingRule.updatedAt'),
  }
}

function mapRuleList(value: unknown, skuId: string): PackagingRule[] {
  return mapList(value, 'packagingRuleList').map((item) =>
    mapRule(item, skuId),
  )
}

function mapScale(value: unknown, expectedWarehouseId?: string): ShippingScale {
  const wire = asRecord(value, 'scale')
  const warehouseId = uuid(wire.warehouseId, 'scale.warehouseId')
  if (
    expectedWarehouseId &&
    warehouseId.toLowerCase() !== expectedWarehouseId.toLowerCase()
  ) {
    return invalid('scale.warehouseId')
  }
  return {
    id: uuid(wire.id, 'scale.id'),
    warehouseId,
    deviceNumber: string(wire.deviceNumber, 'scale.deviceNumber'),
    displayName: string(wire.displayName, 'scale.displayName'),
    status: oneOf(
      wire.status,
      ['ACTIVE', 'INACTIVE'] as const,
      'scale.status',
    ),
    version: integer(wire.version, 'scale.version'),
    updatedAt: timestamp(wire.updatedAt, 'scale.updatedAt'),
  }
}

function mapScaleList(value: unknown, warehouseId: string): ShippingScale[] {
  return mapList(value, 'scaleList').map((item) =>
    mapScale(item, warehouseId),
  )
}

function mapTolerance(value: unknown): WeightTolerance {
  const wire = asRecord(value, 'tolerance')
  if (typeof wire.warehouseOverride !== 'boolean') {
    return invalid('tolerance.warehouseOverride')
  }
  return {
    toleranceGrams: boundedInteger(
      wire.toleranceGrams,
      'tolerance.toleranceGrams',
      0,
      999_999_999,
    ),
    toleranceBasisPoints: boundedInteger(
      wire.toleranceBasisPoints,
      'tolerance.toleranceBasisPoints',
      0,
      10_000,
    ),
    warehouseOverride: wire.warehouseOverride,
  }
}

function warehousePath(warehouseId: string, suffix: string) {
  if (!UUID_PATTERN.test(warehouseId)) return invalidRequest('warehouseId')
  return `${API_BASE}/warehouses/${encodeURIComponent(warehouseId)}/${suffix}`
}

function templatePath(templateId: string) {
  if (!UUID_PATTERN.test(templateId)) return invalidRequest('templateId')
  return `${API_BASE}/packaging-templates/${encodeURIComponent(templateId)}`
}

function scalePath(scaleId: string) {
  if (!UUID_PATTERN.test(scaleId)) return invalidRequest('scaleId')
  return `${API_BASE}/scales/${encodeURIComponent(scaleId)}`
}

function skuRulesPath(skuId: string, ruleId?: string) {
  if (!UUID_PATTERN.test(skuId)) return invalidRequest('skuId')
  const base = `${API_BASE}/skus/${encodeURIComponent(skuId)}/packaging-rules`
  if (ruleId === undefined) return base
  if (!UUID_PATTERN.test(ruleId)) return invalidRequest('ruleId')
  return `${base}/${encodeURIComponent(ruleId)}`
}

export const shippingConfigurationApi = {
  async listTemplates() {
    return mapList(
      await apiClient.request<unknown>(`${API_BASE}/packaging-templates`),
      'templateList',
    ).map(mapTemplate)
  },

  async listWarehousePackaging(warehouseId: string) {
    return mapWarehousePackagingList(
      await apiClient.request<unknown>(
        warehousePath(warehouseId, 'packaging-templates'),
      ),
    )
  },

  async createTemplate(input: CreatePackagingTemplateInput) {
    return mapTemplate(
      await apiClient.request<unknown>(`${API_BASE}/packaging-templates`, {
        method: 'POST',
        body: input,
      }),
    )
  },

  async updateTemplate(
    templateId: string,
    input: UpdatePackagingTemplateInput,
  ) {
    return mapTemplate(
      await apiClient.request<unknown>(templatePath(templateId), {
        method: 'PUT',
        body: input,
      }),
    )
  },

  async listRules(skuId: string) {
    return mapRuleList(
      await apiClient.request<unknown>(skuRulesPath(skuId)),
      skuId,
    )
  },

  async createRule(
    skuId: string,
    input: {
      minQuantity: number
      maxQuantity: number
      packagingTemplateId: string
    },
  ) {
    return mapRule(
      await apiClient.request<unknown>(skuRulesPath(skuId), {
        method: 'POST',
        body: input,
      }),
      skuId,
    )
  },

  async updateRule(
    skuId: string,
    ruleId: string,
    input: {
      version: number
      minQuantity: number
      maxQuantity: number
      packagingTemplateId: string
      status: PackagingRuleStatus
    },
  ) {
    return mapRule(
      await apiClient.request<unknown>(skuRulesPath(skuId, ruleId), {
        method: 'PUT',
        body: input,
      }),
      skuId,
    )
  },

  async setWarehousePackaging(
    warehouseId: string,
    templateId: string,
    enabled: boolean,
  ) {
    if (!UUID_PATTERN.test(templateId)) return invalidRequest('templateId')
    return mapWarehousePackagingList(
      await apiClient.request<unknown>(
        `${warehousePath(warehouseId, 'packaging-templates')}/${encodeURIComponent(templateId)}`,
        { method: 'PUT', body: { enabled } },
      ),
    )
  },

  async listScales(warehouseId: string) {
    return mapScaleList(
      await apiClient.request<unknown>(warehousePath(warehouseId, 'scales')),
      warehouseId,
    )
  },

  async createScale(
    warehouseId: string,
    input: { deviceNumber: string; displayName: string },
  ) {
    return mapScale(
      await apiClient.request<unknown>(warehousePath(warehouseId, 'scales'), {
        method: 'POST',
        body: input,
      }),
      warehouseId,
    )
  },

  async updateScale(
    scaleId: string,
    input: {
      version: number
      warehouseId: string
      displayName: string
      status: ScaleStatus
    },
  ) {
    return mapScale(
      await apiClient.request<unknown>(scalePath(scaleId), {
        method: 'PUT',
        body: input,
      }),
      input.warehouseId,
    )
  },

  async getTolerance(warehouseId: string) {
    return mapTolerance(
      await apiClient.request<unknown>(
        warehousePath(warehouseId, 'weight-tolerance'),
      ),
    )
  },

  async setTolerance(
    warehouseId: string,
    input: { toleranceGrams: number; toleranceBasisPoints: number },
  ) {
    return mapTolerance(
      await apiClient.request<unknown>(
        warehousePath(warehouseId, 'weight-tolerance'),
        { method: 'PUT', body: input },
      ),
    )
  },
}
