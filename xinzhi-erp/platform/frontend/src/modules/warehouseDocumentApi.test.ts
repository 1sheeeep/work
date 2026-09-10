import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { warehouseDocumentApi } from './warehouseDocumentApi'

vi.mock('../api/client', () => ({ apiClient: { request: vi.fn() } }))

const warehouseId = 'a1000000-0000-4000-8000-000000000001'
const documentId = 'a2000000-0000-4000-8000-000000000001'
const document = {
  id: documentId,
  relatedDocumentId: 'a3000000-0000-4000-8000-000000000001',
  source: 'PROCUREMENT_RECEIPT',
  direction: 'INBOUND',
  documentNo: 'PO-20260802-ABC',
  sourceReference: 'PP-20260802-ABC',
  documentType: '采购签收入库',
  warehouseId,
  warehouseCode: 'WH-1',
  warehouseName: '主仓',
  status: 'POSTED',
  approvalStatus: 'NOT_REQUIRED',
  lineCount: 1,
  totalQuantity: 4,
  totalAmount: null,
  currency: null,
  operatorDisplayName: '收货员',
  occurredAt: '2026-08-02T08:00:00Z',
  postedAt: '2026-08-02T08:00:00Z',
}

describe('warehouseDocumentApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('maps a unified document page and sends bounded filters', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [document], page: 0, size: 25, totalElements: 1, totalPages: 1,
    })

    const result = await warehouseDocumentApi.list({
      warehouseId,
      direction: 'INBOUND',
      source: 'PROCUREMENT_RECEIPT',
      searchField: 'DOCUMENT_NO',
      keyword: ' PO-1 ',
      page: 0,
      size: 25,
    })

    expect(result.items[0]).toEqual(expect.objectContaining({
      source: 'PROCUREMENT_RECEIPT',
      totalAmount: undefined,
      currency: undefined,
    }))
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain(
      `warehouseId=${warehouseId}`,
    )
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain(
      'source=PROCUREMENT_RECEIPT',
    )
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain('keyword=PO-1')
  })

  it('accepts and sends the order fulfillment source', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{
        ...document,
        source: 'ORDER_FULFILLMENT',
        direction: 'OUTBOUND',
        documentType: '订单履约出库',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await warehouseDocumentApi.list({
      direction: 'OUTBOUND',
      source: 'ORDER_FULFILLMENT',
      searchField: 'DOCUMENT_NO',
      page: 0,
      size: 25,
    })

    expect(result.items[0].source).toBe('ORDER_FULFILLMENT')
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain(
      'source=ORDER_FULFILLMENT',
    )
  })

  it('accepts inventory count documents with a partial reversal status', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{
        ...document,
        source: 'INVENTORY_COUNT',
        status: 'PARTIALLY_REVERSED',
        documentNo: 'IC-20260802-001',
        documentType: '库存盘盈入库',
        approvalStatus: 'APPROVED',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await warehouseDocumentApi.list({
      direction: 'INBOUND',
      source: 'INVENTORY_COUNT',
      status: 'PARTIALLY_REVERSED',
      searchField: 'DOCUMENT_NO',
      page: 0,
      size: 25,
    })

    expect(result.items[0]).toEqual(expect.objectContaining({
      source: 'INVENTORY_COUNT',
      status: 'PARTIALLY_REVERSED',
    }))
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain(
      'source=INVENTORY_COUNT',
    )
    expect(vi.mocked(apiClient.request).mock.calls[0][0]).toContain(
      'status=PARTIALLY_REVERSED',
    )
  })

  it('rejects inconsistent money and pagination identities', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{ ...document, totalAmount: 12, currency: null }],
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(warehouseDocumentApi.list({
      direction: 'INBOUND', searchField: 'DOCUMENT_NO', page: 0, size: 25,
    })).rejects.toThrow('document.money')

    vi.mocked(apiClient.request).mockResolvedValue({
      items: [], page: 1, size: 25, totalElements: 0, totalPages: 0,
    })
    await expect(warehouseDocumentApi.list({
      direction: 'INBOUND', searchField: 'DOCUMENT_NO', page: 0, size: 25,
    })).rejects.toThrow('page.identity')
  })

  it('exports the bounded filter through the strict CSV contract', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      filename: 'warehouse-documents-inbound.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF单号,单据方向,单据类型\r\nIC-1,入库,库存盘点\r\n',
    })

    const result = await warehouseDocumentApi.exportCsv({
      warehouseId,
      direction: 'INBOUND',
      source: 'INVENTORY_COUNT',
      status: 'PARTIALLY_REVERSED',
      approvalStatus: 'APPROVED',
      searchField: 'DOCUMENT_NO',
      keyword: ' IC-1 ',
      occurredFrom: '2026-08-01T00:00:00.000Z',
      occurredTo: '2026-08-02T23:59:59.999Z',
    })

    expect(result.rowCount).toBe(1)
    expect(apiClient.request).toHaveBeenCalledWith(
      '/api/v1/inventory-center/documents/exports',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          warehouseId,
          direction: 'INBOUND',
          source: 'INVENTORY_COUNT',
          status: 'PARTIALLY_REVERSED',
          approvalStatus: 'APPROVED',
          keyword: 'IC-1',
        }),
      }),
    )
  })

  it('rejects an unsafe export response', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      filename: '../unsafe.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF单号,单据方向,单据类型\r\nIC-1,入库,库存盘点\r\n',
    })

    await expect(warehouseDocumentApi.exportCsv({
      direction: 'INBOUND',
      searchField: 'DOCUMENT_NO',
    })).rejects.toThrow('export.contract')
  })
})
