import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseProcurementPlan,
  parseProcurementPlanSummary,
  procurementPlanApi,
} from './procurementPlanApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ apiClient: { request } }))

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const SKU_ID = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333'
const LOCATION_ID = '44444444-4444-4444-8444-444444444444'
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const plan = {
  planId: PLAN_ID, planNo: 'PP-20260801-11111111', status: 'UNPURCHASED', source: 'MANUAL',
  skuId: SKU_ID, skuCode: 'SKU-1', skuName: '测试 SKU', skuVariant: null,
  warehouseId: WAREHOUSE_ID, warehouseCode: 'WH-1', warehouseName: '主仓',
  locationId: LOCATION_ID, locationCode: 'LOC-1', locationName: '一号位', quantity: 12,
  note: null, applicantDisplayName: '申请人', createdAt: '2026-08-01T10:00:00Z',
  voidReason: null, voidedByDisplayName: null, voidedAt: null,
  version: 0, updatedAt: '2026-08-01T10:00:00Z',
}

beforeEach(() => request.mockReset())

describe('procurement plan API', () => {
  it('loads and strictly parses the unpurchased plan summary', async () => {
    request.mockResolvedValue({ unpurchasedPlans: 7 })

    await expect(procurementPlanApi.summary()).resolves.toEqual({ unpurchasedPlans: 7 })
    expect(request).toHaveBeenCalledWith('/api/v1/procurement/plans/summary')
    expect(() => parseProcurementPlanSummary({ unpurchasedPlans: -1 })).toThrow(/summary\.unpurchasedPlans/)
    expect(() => parseProcurementPlanSummary({ unpurchasedPlans: 7, orderedPlans: 3 })).toThrow(/summary\.shape/)
  })

  it('strictly parses plan identity, enums and state invariants', () => {
    expect(parseProcurementPlan(plan)).toMatchObject({ id: PLAN_ID, status: 'UNPURCHASED', source: 'MANUAL' })
    expect(() => parseProcurementPlan({ ...plan, futureField: true })).toThrow(/plan\.shape/)
    expect(parseProcurementPlan({ ...plan, source: 'SMART' })).toMatchObject({ source: 'SMART' })
    expect(() => parseProcurementPlan({ ...plan, source: 'IMPORT' })).toThrow(/plan\.source/)
    expect(() => parseProcurementPlan({ ...plan, status: 'VOIDED' })).toThrow(/plan\.voidState/)
    expect(() => parseProcurementPlan({ ...plan, locationId: WAREHOUSE_ID })).not.toThrow()
  })

  it('maps canonical filters and validates the strict page envelope', async () => {
    request.mockResolvedValue({ items: [plan], page: 2, size: 50, totalElements: 101, totalPages: 3 })
    await expect(procurementPlanApi.list({ warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, status: 'UNPURCHASED', searchField: 'SKU_CODE', keyword: ' SKU-1 ', createdFrom: '2026-07-01T00:00:00.000Z', createdTo: '2026-08-01T23:59:59.999Z', page: 2, size: 50 })).resolves.toMatchObject({ page: 2, totalElements: 101 })
    const [url] = request.mock.calls[0]
    expect(url).toContain(`warehouseId=${WAREHOUSE_ID}`)
    expect(url).toContain(`locationId=${LOCATION_ID}`)
    expect(url).toContain('searchField=SKU_CODE')
    request.mockResolvedValue({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0, extra: true })
    await expect(procurementPlanApi.list({ searchField: 'PLAN_NO', page: 0, size: 25 })).rejects.toThrow(/page\.shape/)
  })

  it('exports all current list filters through the strict CSV contract', async () => {
    const content = '\uFEFF计划编号,状态,来源,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,计划数量,备注,申请人,申请时间,作废原因,作废人,作废时间,更新时间\r\n'
    request.mockResolvedValue({
      filename: 'procurement-plans.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })

    await expect(procurementPlanApi.exportCsv({
      warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, status: 'VOIDED',
      searchField: 'SKU_NAME', keyword: ' Product ',
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T23:59:59.999Z',
    })).resolves.toEqual({
      filename: 'procurement-plans.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })
    expect(request).toHaveBeenCalledWith('/api/v1/procurement/plans/exports', {
      method: 'POST', body: {
        warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, status: 'VOIDED',
        searchField: 'SKU_NAME', keyword: 'Product',
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-02T23:59:59.999Z',
      },
    })
  })

  it('rejects an unsafe procurement plan export response', async () => {
    request.mockResolvedValue({
      filename: '../procurement-plans.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content: '\uFEFF计划编号,状态\r\n',
    })
    await expect(procurementPlanApi.exportCsv({
      searchField: 'PLAN_NO',
    })).rejects.toThrow(/export\.contract/)
  })

  it('sends bounded idempotent create and void commands without source or future facts', async () => {
    request.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, status: 'VOIDED', voidReason: '无需采购', voidedByDisplayName: '申请人', voidedAt: '2026-08-01T11:00:00Z', version: 1 })
    await procurementPlanApi.create({ commandId: COMMAND_ID, skuId: SKU_ID, warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, quantity: 12, note: '补货' })
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/procurement/plans', {
      method: 'POST', headers: { 'X-Request-Id': `procurement.${COMMAND_ID}` },
      body: { commandId: COMMAND_ID, skuId: SKU_ID, warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, quantity: 12, note: '补货' },
    })
    await procurementPlanApi.void(PLAN_ID, { commandId: COMMAND_ID, expectedVersion: 0, reason: ' 无需采购 ' })
    expect(request).toHaveBeenNthCalledWith(2, `/api/v1/procurement/plans/${PLAN_ID}/void`, {
      method: 'POST', headers: { 'X-Request-Id': `procurement.${COMMAND_ID}` },
      body: { commandId: COMMAND_ID, expectedVersion: 0, reason: '无需采购' },
    })
    await expect(procurementPlanApi.void(PLAN_ID, { commandId: COMMAND_ID, expectedVersion: 0, reason: '\u0001' })).rejects.toThrow(/reason/)
  })

  it('rejects cross-warehouse location reference responses', async () => {
    request.mockResolvedValue({ items: [{ id: LOCATION_ID, warehouseId: '55555555-5555-4555-8555-555555555555', businessCode: 'LOC-1', name: '一号位' }], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    await expect(procurementPlanApi.locations(WAREHOUSE_ID, undefined, 0, 25)).rejects.toThrow(/location\.warehouseId/)
  })

  it('rejects plan and reference pages that do not match the request identity', async () => {
    request.mockResolvedValueOnce({ items: [], page: 0, size: 50, totalElements: 60, totalPages: 2 })
      .mockResolvedValueOnce({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })
    await expect(procurementPlanApi.list({ searchField: 'PLAN_NO', page: 1, size: 50 })).rejects.toThrow(/page\.requestIdentity/)
    await expect(procurementPlanApi.skus(undefined, 0, 50)).rejects.toThrow(/page\.requestIdentity/)
  })
  it('rejects duplicate plan and reference identities within one page', async () => {
    const sku = { id: SKU_ID, businessCode: 'SKU-1', name: '测试 SKU', variantSummary: null }
    request.mockResolvedValueOnce({ items: [plan, plan], page: 0, size: 25, totalElements: 2, totalPages: 1 })
      .mockResolvedValueOnce({ items: [sku, sku], page: 0, size: 25, totalElements: 2, totalPages: 1 })
    await expect(procurementPlanApi.list({ searchField: 'PLAN_NO', page: 0, size: 25 })).rejects.toThrow(/page\.items\.identity/)
    await expect(procurementPlanApi.skus(undefined, 0, 25)).rejects.toThrow(/page\.items\.identity/)
  })
  it('rejects a page whose total count and total pages disagree', async () => {
    request.mockResolvedValue({ items: [], page: 0, size: 25, totalElements: 26, totalPages: 3 })
    await expect(procurementPlanApi.list({ searchField: 'PLAN_NO', page: 0, size: 25 })).rejects.toThrow(/page\.cardinality/)
  })
})
