import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseProcurementOrder, procurementOrderApi } from './procurementOrderApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number; code?: string; details?: unknown
    constructor(message: string, options: { status: number; code?: string; details?: unknown }) { super(message); this.status = options.status; this.code = options.code; this.details = options.details }
  },
  apiClient: { request },
}))
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const SUPPLIER_ID = '33333333-3333-4333-8333-333333333333'
const base = {
  purchaseOrderId: ORDER_ID, purchaseNo: 'PO-20260802-1111111111111111111111111111', status: 'NEW_ORDER', planId: PLAN_ID, planNo: 'PP-20260802-1111111111111111111111111111',
  supplierId: SUPPLIER_ID, supplierCode: 'SUP-1', supplierName: 'Supplier', supplierSkuCode: null,
  skuId: '44444444-4444-4444-8444-444444444444', skuCode: 'SKU-1', skuName: 'Product', skuVariant: null,
  warehouseId: '55555555-5555-4555-8555-555555555555', warehouseCode: 'WH-1', warehouseName: 'Warehouse',
  locationId: '66666666-6666-4666-8666-666666666666', locationCode: 'LOC-1', locationName: 'Location',
  quantity: 12, receivedQuantity: 0, orderNote: null, orderedByDisplayName: 'Operator', reviewDecision: null, reviewNote: null, reviewedByDisplayName: null, reviewedAt: null, version: 0, lastReceivedAt: null, createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-02T10:00:00Z',
}

beforeEach(() => request.mockReset())
describe('procurement order API', () => {
  it('fails closed for shape, identity and unsupported states', () => {
    expect(parseProcurementOrder(base)).toMatchObject({ purchaseOrderId: ORDER_ID, status: 'NEW_ORDER', quantity: 12 })
    expect(parseProcurementOrder({ ...base, planId: null, planNo: null })).toMatchObject({ purchaseOrderId: ORDER_ID, planId: undefined, planNo: undefined })
    expect(() => parseProcurementOrder({ ...base, extra: true })).toThrow(/Invalid procurement order response/)
    expect(() => parseProcurementOrder({ ...base, status: 'PAID' })).toThrow(/Invalid procurement order response/)
    expect(() => parseProcurementOrder({ ...base, status: 'RECEIVED', receivedQuantity: 3 })).toThrow(/Invalid procurement order response/)
  })

  it('creates with an idempotency request and checks plan and supplier identity', async () => {
    request.mockResolvedValueOnce(base)
    await expect(procurementOrderApi.create({ commandId: '77777777-7777-4777-8777-777777777777', planId: PLAN_ID, expectedPlanVersion: 0, supplierId: SUPPLIER_ID })).resolves.toMatchObject({ purchaseOrderId: ORDER_ID })
    expect(request).toHaveBeenCalledWith('/api/v1/procurement/orders', expect.objectContaining({ method: 'POST', headers: { 'X-Request-Id': 'procurement-order.77777777-7777-4777-8777-777777777777' } }))
  })

  it('creates a purchase order directly and loads supplier mappings by SKU', async () => {
    const direct = { ...base, planId: null, planNo: null }
    request.mockResolvedValueOnce(direct).mockResolvedValueOnce({
      items: [{ supplierId: SUPPLIER_ID, supplierCode: 'SUP-1', supplierName: 'Supplier', supplierSkuCode: null, preferred: true, leadTimeDays: 7 }],
      page: 0, size: 50, totalElements: 1, totalPages: 1,
    })
    const commandId = '77777777-7777-4777-8777-777777777778'
    await expect(procurementOrderApi.createDirect({ commandId, supplierId: SUPPLIER_ID, skuId: base.skuId, warehouseId: base.warehouseId, locationId: base.locationId, quantity: 12, orderNote: ' replenishment ' })).resolves.toMatchObject({ planId: undefined, planNo: undefined })
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/procurement/orders/direct', {
      method: 'POST', headers: { 'X-Request-Id': `procurement-order.${commandId}` },
      body: { commandId, supplierId: SUPPLIER_ID, skuId: base.skuId, warehouseId: base.warehouseId, locationId: base.locationId, quantity: 12, orderNote: 'replenishment' },
    })
    await procurementOrderApi.suppliersForSku(base.skuId, ' Supplier ', 0, 50)
    expect(request).toHaveBeenNthCalledWith(2, `/api/v1/procurement/orders/references/skus/${base.skuId}/suppliers?page=0&size=50&keyword=Supplier`)
  })

  it('posts a bounded receipt with its own idempotency command', async () => {
    request.mockResolvedValueOnce({ ...base, status: 'PARTIALLY_RECEIVED', receivedQuantity: 5, reviewDecision: 'APPROVED', reviewedByDisplayName: 'Reviewer', reviewedAt: '2026-08-02T10:30:00Z', version: 2, lastReceivedAt: '2026-08-02T11:00:00Z' })
    await expect(procurementOrderApi.receive({ commandId: '88888888-8888-4888-8888-888888888888', purchaseOrderId: ORDER_ID, expectedVersion: 0, quantity: 5 })).resolves.toMatchObject({ receivedQuantity: 5, status: 'PARTIALLY_RECEIVED' })
    expect(request).toHaveBeenCalledWith(`/api/v1/procurement/orders/${ORDER_ID}/receipts`, expect.objectContaining({ method: 'POST', body: { commandId: '88888888-8888-4888-8888-888888888888', expectedVersion: 0, quantity: 5 } }))
  })

  it('loads only receivable orders when requested by the receiving workbench', async () => {
    request.mockResolvedValueOnce({ items: [{ ...base, status: 'APPROVED', reviewDecision: 'APPROVED', reviewedByDisplayName: 'Reviewer', reviewedAt: '2026-08-02T10:30:00Z', version: 1 }], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    await procurementOrderApi.list({
      searchField: 'PURCHASE_NO', receivableOnly: true, page: 0, size: 50,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/procurement/orders?searchField=PURCHASE_NO&page=0&size=50&receivableOnly=true',
      { signal: undefined },
    )
  })

  it('reviews a pending order and preserves the response identity', async () => {
    request.mockResolvedValueOnce({
      ...base,
      status: 'APPROVED',
      reviewDecision: 'APPROVED',
      reviewNote: 'Stock replenishment approved',
      reviewedByDisplayName: 'Reviewer',
      reviewedAt: '2026-08-02T10:30:00Z',
      version: 1,
      updatedAt: '2026-08-02T10:30:00Z',
    })
    await expect(procurementOrderApi.review({
      commandId: '99999999-9999-4999-8999-999999999999',
      purchaseOrderId: ORDER_ID,
      expectedVersion: 0,
      approved: true,
      reviewNote: ' Stock replenishment approved ',
    })).resolves.toMatchObject({ status: 'APPROVED', reviewDecision: 'APPROVED' })
    expect(request).toHaveBeenCalledWith(`/api/v1/procurement/orders/${ORDER_ID}/review`, {
      method: 'POST',
      headers: { 'X-Request-Id': 'procurement-order.99999999-9999-4999-8999-999999999999' },
      body: { expectedVersion: 0, approved: true, reviewNote: 'Stock replenishment approved' },
    })
  })

  it('rejects a received order from the receivable-only result', async () => {
    request.mockResolvedValueOnce({
      items: [{ ...base, status: 'RECEIVED', receivedQuantity: 12 }],
      page: 0, size: 50, totalElements: 1, totalPages: 1,
    })

    await expect(procurementOrderApi.list({
      searchField: 'PURCHASE_NO', receivableOnly: true, page: 0, size: 50,
    })).rejects.toThrow(/Invalid procurement order response/)
  })

  it('exports bounded follow-up filters through the strict CSV contract', async () => {
    const content = '\uFEFF采购单号,计划编号,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,供应商编码,供应商名称,供应商SKU,采购数量,已到货,待到货,状态,下单员,下单时间,最近到货\r\n'
    request.mockResolvedValueOnce({
      filename: 'procurement-follow-up.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })

    await expect(procurementOrderApi.exportFollowUpCsv({
      searchField: 'SUPPLIER_NAME',
      keyword: ' Supplier ',
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T23:59:59.999Z',
    })).resolves.toEqual({
      filename: 'procurement-follow-up.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/procurement/orders/follow-up/exports',
      {
        method: 'POST',
        body: {
          searchField: 'SUPPLIER_NAME',
          keyword: 'Supplier',
          createdFrom: '2026-08-01T00:00:00.000Z',
          createdTo: '2026-08-02T23:59:59.999Z',
        },
      },
    )
  })

  it('rejects an unsafe follow-up export response', async () => {
    request.mockResolvedValueOnce({
      filename: '../procurement-follow-up.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF采购单号,计划编号\r\n',
    })

    await expect(procurementOrderApi.exportFollowUpCsv({
      searchField: 'PURCHASE_NO',
    })).rejects.toThrow(/Invalid procurement order response/)
  })

  it('exports the current order filters through the strict CSV contract', async () => {
    const content = '\uFEFF采购单号,状态,计划编号,供应商编码,供应商名称,供应商SKU,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,采购数量,已收数量,待收数量,订单备注,下单员,最近到货,创建时间,更新时间\r\n'
    request.mockResolvedValueOnce({
      filename: 'procurement-orders.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })

    await expect(procurementOrderApi.exportCsv({
      status: 'PARTIALLY_RECEIVED', receivableOnly: true,
      searchField: 'SUPPLIER_NAME',
      keyword: ' Supplier ', createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T23:59:59.999Z',
    })).resolves.toEqual({
      filename: 'procurement-orders.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })
    expect(request).toHaveBeenCalledWith('/api/v1/procurement/orders/exports', {
      method: 'POST',
      body: {
        status: 'PARTIALLY_RECEIVED', receivableOnly: true,
        searchField: 'SUPPLIER_NAME',
        keyword: 'Supplier', createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-02T23:59:59.999Z',
      },
    })
  })

  it('rejects an unsafe purchase order export response', async () => {
    request.mockResolvedValueOnce({
      filename: '../procurement-orders.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content: '\uFEFF采购单号,状态\r\n',
    })
    await expect(procurementOrderApi.exportCsv({
      searchField: 'PURCHASE_NO',
    })).rejects.toThrow(/Invalid procurement order response/)
  })

  it('rejects order and supplier pages that do not match the request identity', async () => {
    request.mockResolvedValueOnce({ items: [], page: 0, size: 50, totalElements: 60, totalPages: 2 })
      .mockResolvedValueOnce({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })
    await expect(procurementOrderApi.list({ searchField: 'PURCHASE_NO', page: 1, size: 50 })).rejects.toThrow(/Invalid procurement order response/)
    await expect(procurementOrderApi.suppliers(PLAN_ID, undefined, 0, 50)).rejects.toThrow(/Invalid procurement order response/)
  })
  it('rejects duplicate order and supplier identities within one page', async () => {
    const supplier = { supplierId: SUPPLIER_ID, supplierCode: 'SUP-1', supplierName: 'Supplier', supplierSkuCode: null, preferred: true, leadTimeDays: null }
    request.mockResolvedValueOnce({ items: [base, base], page: 0, size: 50, totalElements: 2, totalPages: 1 })
      .mockResolvedValueOnce({ items: [supplier, supplier], page: 0, size: 50, totalElements: 2, totalPages: 1 })
    await expect(procurementOrderApi.list({ searchField: 'PURCHASE_NO', page: 0, size: 50 })).rejects.toThrow(/Invalid procurement order response/)
    await expect(procurementOrderApi.suppliers(PLAN_ID, undefined, 0, 50)).rejects.toThrow(/Invalid procurement order response/)
  })
  it('rejects a page whose total count and total pages disagree', async () => {
    request.mockResolvedValue({ items: [], page: 0, size: 50, totalElements: 51, totalPages: 3 })
    await expect(procurementOrderApi.list({ searchField: 'PURCHASE_NO', page: 0, size: 50 })).rejects.toThrow(/Invalid procurement order response/)
  })
})
