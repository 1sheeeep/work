import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/statistics'

export type LogisticsStatisticsDimension = 'COUNTRY' | 'CHANNEL'

export type LogisticsStatisticsStatus = {
  status?: string
  recordCount: number
}

export type LogisticsStatisticsGroup = {
  groupValue?: string
  recordCount: number
  statuses: LogisticsStatisticsStatus[]
}

export type LogisticsStatisticsPage = {
  items: LogisticsStatisticsGroup[]
  totalStatuses: LogisticsStatisticsStatus[]
  dimension: LogisticsStatisticsDimension
  totalRecords: number
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type LogisticsStatisticsExport = {
  filename: 'logistics-statistics.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type LogisticsStatisticsRequest = {
  dimension: LogisticsStatisticsDimension
  value?: string
  shippedFrom?: string
  shippedToExclusive?: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid logistics statistics response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid logistics statistics request', {
    status: 400,
    code: 'invalid_request',
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

function optionalText(value: unknown, field: string) {
  return value == null ? undefined : text(value, field)
}

function integer(value: unknown, field: string, positive = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (positive ? 1 : 0)) invalid(field)
  return value
}

function dimension(value: unknown, field: string): LogisticsStatisticsDimension {
  if (value !== 'COUNTRY' && value !== 'CHANNEL') invalid(field)
  return value
}

function parseStatus(value: unknown): LogisticsStatisticsStatus {
  const wire = record(value, 'status')
  exact(wire, ['status', 'recordCount'], 'status')
  return {
    status: optionalText(wire.status, 'status.status'),
    recordCount: integer(wire.recordCount, 'status.recordCount', true),
  }
}

function parseGroup(value: unknown): LogisticsStatisticsGroup {
  const wire = record(value, 'group')
  exact(wire, ['groupValue', 'recordCount', 'statuses'], 'group')
  if (!Array.isArray(wire.statuses) || wire.statuses.length === 0) {
    invalid('group.statuses')
  }
  const statuses = wire.statuses.map(parseStatus)
  const statusKeys = statuses.map((item) => item.status ?? '')
  const recordCount = integer(wire.recordCount, 'group.recordCount', true)
  if (new Set(statusKeys).size !== statusKeys.length
    || statuses.reduce((total, item) => total + item.recordCount, 0) !== recordCount) {
    invalid('group.statuses.identity')
  }
  return {
    groupValue: optionalText(wire.groupValue, 'group.groupValue'),
    recordCount,
    statuses,
  }
}

function exportResult(value: unknown): LogisticsStatisticsExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (wire.filename !== 'logistics-statistics.csv'
    || wire.mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF统计维度,分组值,跟踪状态,状态记录数,分组记录数\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'logistics-statistics.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

export const logisticsStatisticsApi = {
  async summarize(
    request: LogisticsStatisticsRequest,
  ): Promise<LogisticsStatisticsPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1
      || request.size > 100) invalidRequest('page')
    const from = request.shippedFrom ? Date.parse(request.shippedFrom) : undefined
    const to = request.shippedToExclusive
      ? Date.parse(request.shippedToExclusive)
      : undefined
    if ((from !== undefined && Number.isNaN(from))
      || (to !== undefined && Number.isNaN(to))
      || (from !== undefined && to !== undefined && from >= to)) {
      invalidRequest('shipmentWindow')
    }
    const query = new URLSearchParams({
      dimension: request.dimension,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.value?.trim()) query.set('value', request.value.trim().slice(0, 100))
    if (request.shippedFrom) query.set('shippedFrom', request.shippedFrom)
    if (request.shippedToExclusive) {
      query.set('shippedToExclusive', request.shippedToExclusive)
    }
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    exact(wire, [
      'items', 'totalStatuses', 'dimension', 'totalRecords', 'page', 'size',
      'totalElements', 'totalPages',
    ], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    if (!Array.isArray(wire.totalStatuses)) invalid('page.totalStatuses')
    const result: LogisticsStatisticsPage = {
      items: wire.items.map(parseGroup),
      totalStatuses: wire.totalStatuses.map(parseStatus),
      dimension: dimension(wire.dimension, 'page.dimension'),
      totalRecords: integer(wire.totalRecords, 'page.totalRecords'),
      page: integer(wire.page, 'page.page'),
      size: integer(wire.size, 'page.size', true),
      totalElements: integer(wire.totalElements, 'page.totalElements'),
      totalPages: integer(wire.totalPages, 'page.totalPages'),
    }
    const expectedPages = result.totalElements === 0
      ? 0
      : Math.ceil(result.totalElements / result.size)
    const groupKeys = result.items.map((item) => item.groupValue ?? '')
    const currentRecords = result.items.reduce(
      (total, item) => total + item.recordCount,
      0,
    )
    const totalStatusKeys = result.totalStatuses.map((item) => item.status ?? '')
    const totalStatusRecords = result.totalStatuses.reduce(
      (total, item) => total + item.recordCount,
      0,
    )
    if (result.dimension !== request.dimension
      || result.page !== request.page
      || result.size !== request.size
      || result.totalPages !== expectedPages
      || result.items.length > result.size
      || result.items.length > result.totalElements
      || new Set(groupKeys).size !== groupKeys.length
      || currentRecords > result.totalRecords
      || new Set(totalStatusKeys).size !== totalStatusKeys.length
      || totalStatusRecords !== result.totalRecords) invalid('page.identity')
    return result
  },
  async exportCsv(
    request: Omit<LogisticsStatisticsRequest, 'page' | 'size' | 'signal'>,
  ): Promise<LogisticsStatisticsExport> {
    const from = request.shippedFrom ? Date.parse(request.shippedFrom) : undefined
    const to = request.shippedToExclusive
      ? Date.parse(request.shippedToExclusive)
      : undefined
    if ((from !== undefined && Number.isNaN(from))
      || (to !== undefined && Number.isNaN(to))
      || (from !== undefined && to !== undefined && from >= to)) {
      invalidRequest('shipmentWindow')
    }
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        dimension: request.dimension,
        value: request.value?.trim().slice(0, 100) || undefined,
        shippedFrom: request.shippedFrom,
        shippedToExclusive: request.shippedToExclusive,
      },
    }))
  },
}
