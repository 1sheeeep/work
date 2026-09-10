import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseProcurementRecommendationPage,
  procurementRecommendationApi,
} from './procurementRecommendationApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, options: { status: number }) { super(message); this.status = options.status }
  },
  apiClient: { request },
}))

const item = {
  skuId: '11111111-1111-4111-8111-111111111111', skuCode: 'SKU-A', skuName: '商品 A', skuVariant: null,
  warehouseId: '22222222-2222-4222-8222-222222222222', warehouseCode: 'WH-A', warehouseName: '主仓',
  onHand: 4, reserved: 1, available: 3, last28DaysSalesQuantity: 28, openPurchaseQuantity: 2,
  supplierId: '33333333-3333-4333-8333-333333333333', supplierCode: 'SUP-A', supplierName: '供应商 A', supplierSkuCode: null,
  supplierLeadTimeDays: 14, planningLeadTimeDays: 14, safetyDays: 7, targetCoverageDays: 21,
  targetStockQuantity: 21, recommendedQuantity: 16, activeLocationCount: 1,
}
const response = {
  items: [item], locations: [{ id: '44444444-4444-4444-8444-444444444444', warehouseId: item.warehouseId, businessCode: 'RECEIVE', name: '收货区' }],
  totalElements: 1, actionableCount: 1, totalRecommendedQuantity: 16,
  salesWindowDays: 28, defaultLeadTimeDays: 28, safetyDays: 7,
  observedAt: '2026-08-11T05:00:00Z', page: 0, size: 25, totalPages: 1,
}

beforeEach(() => request.mockReset())

describe('procurement recommendation API', () => {
  it('strictly parses recommendation facts and sends deterministic query filters', async () => {
    request.mockResolvedValue(response)
    await expect(procurementRecommendationApi.list({
      supplier: ' SUP-A ', keyword: ' SKU-A ', hideWithoutSupplier: true,
      hideZeroRecommendation: true, asOf: response.observedAt, page: 0, size: 25,
    })).resolves.toMatchObject({ actionableCount: 1, totalRecommendedQuantity: 16 })
    expect(request.mock.calls[0][0]).toContain('supplier=SUP-A')
    expect(request.mock.calls[0][0]).toContain('hideZeroRecommendation=true')
  })

  it('rejects formula drift, future fields and inconsistent paging', () => {
    expect(() => parseProcurementRecommendationPage({
      ...response, items: [{ ...item, targetCoverageDays: 22 }],
    })).toThrow()
    expect(() => parseProcurementRecommendationPage({
      ...response, items: [{ ...item, unitCost: 2 }],
    })).toThrow()
    expect(() => parseProcurementRecommendationPage({
      ...response, totalElements: 26, totalPages: 1,
    })).toThrow()
  })

  it('generates exact selected recommendations with an idempotency header', async () => {
    const commandId = '55555555-5555-4555-8555-555555555555'
    request.mockResolvedValue({
      commandId, observedAt: response.observedAt,
      items: [{ purchaseOrderId: '66666666-6666-4666-8666-666666666666', purchaseNo: 'PO-1', planId: '77777777-7777-4777-8777-777777777777', planNo: 'PP-1', skuId: item.skuId, warehouseId: item.warehouseId, locationId: response.locations[0].id, supplierId: item.supplierId, quantity: 16 }],
    })
    const input = { commandId, observedAt: response.observedAt, items: [{ skuId: item.skuId, warehouseId: item.warehouseId, locationId: response.locations[0].id, expectedRecommendedQuantity: 16, quantity: 16 }] }
    await expect(procurementRecommendationApi.generate(input)).resolves.toMatchObject({ commandId })
    expect(request).toHaveBeenCalledWith('/api/v1/procurement/recommendations/generate', {
      method: 'POST', headers: { 'X-Request-Id': `procurement-recommendation.${commandId}` }, body: input,
    })
  })

  it('enforces the recommendation CSV contract', async () => {
    const content = '\uFEFFSKU编号,SKU名称,规格,仓库编码,仓库名称,现货\r\n'
    request.mockResolvedValue({ filename: 'procurement-recommendations.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 0, content })
    await expect(procurementRecommendationApi.exportCsv({ asOf: response.observedAt })).resolves.toMatchObject({ rowCount: 0 })
  })
})
