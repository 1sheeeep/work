import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseProcurementReceipt, procurementReceiptApi } from './procurementReceiptApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error { status: number; code?: string; details?: unknown; constructor(message: string, options: { status: number; code?: string; details?: unknown }) { super(message); this.status = options.status; this.code = options.code; this.details = options.details } },
  apiClient: { request },
}))
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const receipt = {
  receiptId: '22222222-2222-4222-8222-222222222222', purchaseOrderId: ORDER_ID, purchaseNo: 'PO-1', planNo: 'PP-1',
  supplierId: '33333333-3333-4333-8333-333333333333', supplierCode: 'SUP-1', supplierName: 'Supplier',
  skuId: '44444444-4444-4444-8444-444444444444', skuCode: 'SKU-1', skuName: 'Product', skuVariant: null,
  warehouseId: '55555555-5555-4555-8555-555555555555', warehouseCode: 'WH-1', warehouseName: 'Warehouse',
  locationId: '66666666-6666-4666-8666-666666666666', locationCode: 'A-1', locationName: 'A', quantity: 5,
  inventoryEventId: '77777777-7777-4777-8777-777777777777', inventoryLedgerSequence: 9, inventoryBalanceAfter: -2,
  receivedByDisplayName: 'Operator', receivedAt: '2026-08-02T12:00:00Z',
}
beforeEach(() => request.mockReset())

describe('procurement receipt API', () => {
  it('parses exact receipt facts and permits a negative balance snapshot', () => {
    expect(parseProcurementReceipt(receipt)).toMatchObject({ quantity: 5, inventoryBalanceAfter: -2 })
    expect(() => parseProcurementReceipt({ ...receipt, unknown: true })).toThrow(/Invalid procurement receipt response/)
  })
  it('loads global and order receipt pages through bounded endpoints', async () => {
    const page = { items: [receipt], page: 0, size: 50, totalElements: 1, totalPages: 1 }
    request.mockResolvedValueOnce(page).mockResolvedValueOnce(page)
    await procurementReceiptApi.list({ sort: 'SKU_CODE', supplierKeyword: ' SUP ', purchaseKeyword: ' PO-1 ', page: 0, size: 50 })
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/procurement/orders/receipts?sort=SKU_CODE&page=0&size=50&supplierKeyword=SUP&purchaseKeyword=PO-1', expect.any(Object))
    await procurementReceiptApi.forOrder(ORDER_ID)
    expect(request).toHaveBeenNthCalledWith(2, `/api/v1/procurement/orders/${ORDER_ID}/receipts?page=0&size=50`, { signal: undefined })
  })
  it('exports bounded receipt filters through the strict CSV contract', async () => {
    const content = '\uFEFF入库时间,采购单号,计划编号,供应商编码,供应商名称,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,本次入库,入库后库存,库存事件序号,库存事件ID,操作人\r\n'
    request.mockResolvedValueOnce({
      filename: 'procurement-receipt-ledger.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })

    await expect(procurementReceiptApi.exportLedgerCsv({
      sort: 'SKU_CODE',
      supplierKeyword: ' Supplier ',
      purchaseKeyword: ' PO-1 ',
      receivedFrom: '2026-08-01T00:00:00.000Z',
      receivedTo: '2026-08-02T23:59:59.999Z',
    })).resolves.toEqual({
      filename: 'procurement-receipt-ledger.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/procurement/orders/receipts/exports',
      {
        method: 'POST',
        body: {
          supplierKeyword: 'Supplier',
          purchaseKeyword: 'PO-1',
          receivedFrom: '2026-08-01T00:00:00.000Z',
          receivedTo: '2026-08-02T23:59:59.999Z',
          sort: 'SKU_CODE',
        },
      },
    )
  })
  it('rejects an unsafe receipt ledger export response', async () => {
    request.mockResolvedValueOnce({
      filename: '../procurement-receipt-ledger.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF入库时间,采购单号\r\n',
    })

    await expect(procurementReceiptApi.exportLedgerCsv({
      sort: 'RECEIVED_AT',
    })).rejects.toThrow(/Invalid procurement receipt response/)
  })
  it('rejects a page that does not match the requested page identity', async () => {
    request.mockResolvedValue({ items: [], page: 0, size: 50, totalElements: 51, totalPages: 2 })
    await expect(procurementReceiptApi.forOrder(ORDER_ID, 1, 50)).rejects.toThrow(/Invalid procurement receipt response/)
  })
  it('rejects duplicate receipts and cross-order receipt history', async () => {
    const page = { items: [receipt, receipt], page: 0, size: 50, totalElements: 2, totalPages: 1 }
    request.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, items: [{ ...receipt, purchaseOrderId: '88888888-8888-4888-8888-888888888888' }], totalElements: 1 })
    await expect(procurementReceiptApi.list({ sort: 'RECEIVED_AT', page: 0, size: 50 })).rejects.toThrow(/Invalid procurement receipt response/)
    await expect(procurementReceiptApi.forOrder(ORDER_ID)).rejects.toThrow(/Invalid procurement receipt response/)
  })
  it('rejects a page whose total count and total pages disagree', async () => {
    request.mockResolvedValue({ items: [], page: 0, size: 50, totalElements: 51, totalPages: 3 })
    await expect(procurementReceiptApi.list({ sort: 'RECEIVED_AT', page: 0, size: 50 })).rejects.toThrow(/Invalid procurement receipt response/)
  })
})
