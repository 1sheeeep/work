import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/logistics/inquiries'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LogisticsInquiryStatus = 'BIDDING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
export type LogisticsInquiry = {
  id: string
  inquiryNo: string
  origin: string
  destination: string
  weeklyOrderCount: number
  weeklyWeightKg: number
  category: string
  contactName: string
  contactPhone: string
  status: LogisticsInquiryStatus
  note?: string
  activeQuoteCount: number
  publishedAt: string
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type LogisticsInquiryQuote = {
  id: string
  inquiryId: string
  providerName: string
  serviceName: string
  pricePerKg: number
  currency: string
  transitDays: number
  note?: string
  status: 'ACTIVE' | 'WITHDRAWN'
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type LogisticsInquiryDetail = { inquiry: LogisticsInquiry; quotes: LogisticsInquiryQuote[] }
export type LogisticsInquiryContact = { contactName?: string; contactPhone?: string; version?: number; updatedAt?: string }
export type LogisticsInquiryPageData = { items: LogisticsInquiry[]; page: number; size: number; totalElements: number; totalPages: number }
export type LogisticsInquiryInput = {
  origin: string
  destination: string
  weeklyOrderCount: number
  weeklyWeightKg: number
  category: string
  contactName: string
  contactPhone: string
  note?: string
}
export type LogisticsQuoteInput = {
  providerName: string
  serviceName: string
  pricePerKg: number
  currency: string
  transitDays: number
  note?: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid logistics inquiry response', { status: 502, code: 'invalid_response', details: { field } }) }
function object(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optionalText(value: unknown, field: string) { return value === null ? undefined : text(value, field) }
function numberValue(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field); return value }
function integer(value: unknown, field: string) { const result = numberValue(value, field); if (!Number.isSafeInteger(result) || result < 0) invalid(field); return result }
function instant(value: unknown, field: string) { const result = text(value, field); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function optionalInstant(value: unknown, field: string) { return value === null ? undefined : instant(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); if (!UUID.test(result)) invalid(field); return result }
function inquiry(value: unknown): LogisticsInquiry {
  const wire = object(value, 'inquiry')
  exact(wire, ['id', 'inquiryNo', 'origin', 'destination', 'weeklyOrderCount', 'weeklyWeightKg', 'category', 'contactName', 'contactPhone', 'status', 'note', 'activeQuoteCount', 'publishedAt', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'], 'inquiry')
  if (!['BIDDING', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(String(wire.status))) invalid('inquiry.status')
  return {
    id: uuid(wire.id, 'inquiry.id'), inquiryNo: text(wire.inquiryNo, 'inquiry.inquiryNo'),
    origin: text(wire.origin, 'inquiry.origin'), destination: text(wire.destination, 'inquiry.destination'),
    weeklyOrderCount: integer(wire.weeklyOrderCount, 'inquiry.weeklyOrderCount'),
    weeklyWeightKg: numberValue(wire.weeklyWeightKg, 'inquiry.weeklyWeightKg'), category: text(wire.category, 'inquiry.category'),
    contactName: text(wire.contactName, 'inquiry.contactName'), contactPhone: text(wire.contactPhone, 'inquiry.contactPhone'),
    status: wire.status as LogisticsInquiryStatus, note: optionalText(wire.note, 'inquiry.note'),
    activeQuoteCount: integer(wire.activeQuoteCount, 'inquiry.activeQuoteCount'),
    publishedAt: instant(wire.publishedAt, 'inquiry.publishedAt'), createdByDisplayName: text(wire.createdByDisplayName, 'inquiry.createdByDisplayName'),
    version: integer(wire.version, 'inquiry.version'), createdAt: instant(wire.createdAt, 'inquiry.createdAt'), updatedAt: instant(wire.updatedAt, 'inquiry.updatedAt'),
  }
}
function quote(value: unknown): LogisticsInquiryQuote {
  const wire = object(value, 'quote')
  exact(wire, ['id', 'inquiryId', 'providerName', 'serviceName', 'pricePerKg', 'currency', 'transitDays', 'note', 'status', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'], 'quote')
  if (wire.status !== 'ACTIVE' && wire.status !== 'WITHDRAWN') invalid('quote.status')
  return {
    id: uuid(wire.id, 'quote.id'), inquiryId: uuid(wire.inquiryId, 'quote.inquiryId'), providerName: text(wire.providerName, 'quote.providerName'),
    serviceName: text(wire.serviceName, 'quote.serviceName'), pricePerKg: numberValue(wire.pricePerKg, 'quote.pricePerKg'),
    currency: text(wire.currency, 'quote.currency'), transitDays: integer(wire.transitDays, 'quote.transitDays'),
    note: optionalText(wire.note, 'quote.note'), status: wire.status,
    createdByDisplayName: text(wire.createdByDisplayName, 'quote.createdByDisplayName'), version: integer(wire.version, 'quote.version'),
    createdAt: instant(wire.createdAt, 'quote.createdAt'), updatedAt: instant(wire.updatedAt, 'quote.updatedAt'),
  }
}
function detail(value: unknown): LogisticsInquiryDetail { const wire = object(value, 'detail'); exact(wire, ['inquiry', 'quotes'], 'detail'); if (!Array.isArray(wire.quotes)) invalid('detail.quotes'); return { inquiry: inquiry(wire.inquiry), quotes: wire.quotes.map(quote) } }
function page(value: unknown): LogisticsInquiryPageData { const wire = object(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page'); if (!Array.isArray(wire.items)) invalid('page.items'); return { items: wire.items.map(inquiry), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') } }
function contact(value: unknown): LogisticsInquiryContact {
  const wire = object(value, 'contact'); exact(wire, ['contactName', 'contactPhone', 'version', 'updatedAt'], 'contact')
  return { contactName: optionalText(wire.contactName, 'contact.contactName'), contactPhone: optionalText(wire.contactPhone, 'contact.contactPhone'), version: wire.version === null ? undefined : integer(wire.version, 'contact.version'), updatedAt: optionalInstant(wire.updatedAt, 'contact.updatedAt') }
}
function requestId() { return `logistics-inquiry.${crypto.randomUUID()}` }

export const logisticsInquiryApi = {
  async list(input: { view: 'MARKET' | 'MY_INQUIRIES'; status?: LogisticsInquiryStatus; country?: string; publishedFrom?: string; publishedTo?: string; page: number; pageSize: number; signal?: AbortSignal }) {
    const params = new URLSearchParams({ view: input.view, status: input.status ?? 'ALL', page: String(input.page), pageSize: String(input.pageSize) })
    for (const key of ['country', 'publishedFrom', 'publishedTo'] as const) if (input[key]) params.set(key, input[key])
    return page(await apiClient.request<unknown>(`${BASE}?${params}`, { signal: input.signal }))
  },
  async detail(id: string) { return detail(await apiClient.request<unknown>(`${BASE}/${id}`)) },
  async contact() { return contact(await apiClient.request<unknown>(`${BASE}/contact`)) },
  async saveContact(input: { contactName: string; contactPhone: string; version?: number }) { return contact(await apiClient.request<unknown>(`${BASE}/contact`, { method: 'PUT', headers: { 'X-Request-Id': requestId() }, body: input })) },
  async create(input: LogisticsInquiryInput) { return inquiry(await apiClient.request<unknown>(BASE, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input })) },
  async update(id: string, version: number, input: LogisticsInquiryInput) { return inquiry(await apiClient.request<unknown>(`${BASE}/${id}`, { method: 'PUT', headers: { 'X-Request-Id': requestId() }, body: { ...input, version } })) },
  async transition(id: string, version: number, status: LogisticsInquiryStatus) { return inquiry(await apiClient.request<unknown>(`${BASE}/${id}/status`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version, status } })) },
  async addQuote(id: string, input: LogisticsQuoteInput) { return detail(await apiClient.request<unknown>(`${BASE}/${id}/quotes`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input })) },
  async withdrawQuote(inquiryId: string, quoteId: string, version: number) { return detail(await apiClient.request<unknown>(`${BASE}/${inquiryId}/quotes/${quoteId}/withdraw`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version } })) },
}
