import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { manualMovementApi } from '../modules/manualMovementApi'
import { warehouseDocumentApi } from '../modules/warehouseDocumentApi'
import {
  InboundOutboundDocumentsPage,
  parseInboundOutboundDocumentsQuery,
  toInboundOutboundDocumentsUrl,
} from './InboundOutboundDocumentsPage'

const routerState = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}))

vi.mock('../modules/manualMovementApi', () => ({
  manualMovementApi: {
    get: vi.fn(),
    warehouseOptions: vi.fn(),
  },
}))
vi.mock('../modules/warehouseDocumentApi', () => ({
  warehouseDocumentApi: { list: vi.fn(), exportCsv: vi.fn() },
}))

const warehouseId = 'a4700000-0000-4000-8000-000000000002'
const movementId = 'a4700000-0000-4000-8000-000000000001'
const now = '2026-08-02T01:00:00Z'
const manualSummary = {
  id: movementId,
  movementNo: 'MI-20260802-001',
  direction: 'INBOUND' as const,
  status: 'POSTED' as const,
  warehouseId,
  warehouseBusinessCode: 'WH-A',
  warehouseName: '杭州仓',
  movementTypeName: '盘盈入库',
  reasonCode: 'FOUND_STOCK' as const,
  source: 'MANUAL' as const,
  wmsStatus: 'NOT_REQUIRED' as const,
  approvalStatus: 'APPROVED' as const,
  entryMode: 'PRODUCT' as const,
  sourceReference: 'SRC-100',
  extensionAttributes: {},
  lineCount: 1,
  totalQuantity: 3,
  totalActualQuantity: 3,
  totalAmount: 30,
  currency: 'CNY',
  version: 1,
  createdBy: '测试用户',
  postedAt: now,
  createdAt: now,
  updatedAt: now,
}
const documentSummary = {
  id: movementId,
  relatedDocumentId: movementId,
  source: 'MANUAL_MOVEMENT' as const,
  direction: 'INBOUND' as const,
  documentNo: manualSummary.movementNo,
  sourceReference: manualSummary.sourceReference,
  documentType: manualSummary.movementTypeName,
  warehouseId,
  warehouseCode: manualSummary.warehouseBusinessCode,
  warehouseName: manualSummary.warehouseName,
  status: 'POSTED' as const,
  approvalStatus: 'APPROVED' as const,
  lineCount: 1,
  totalQuantity: 3,
  totalAmount: 30,
  currency: 'CNY',
  operatorDisplayName: manualSummary.createdBy,
  occurredAt: now,
  postedAt: now,
}

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  vi.mocked(manualMovementApi.warehouseOptions).mockResolvedValue({
    items: [{ id: warehouseId, businessCode: 'WH-A', name: '杭州仓' }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  })
  vi.mocked(warehouseDocumentApi.list).mockResolvedValue({
    items: [documentSummary],
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  })
  vi.mocked(warehouseDocumentApi.exportCsv).mockResolvedValue({
    filename: 'warehouse-documents-inbound.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 1,
    content: '\uFEFF单号,单据方向,单据类型\r\nMI-1,入库,手工入库\r\n',
  })
  vi.mocked(manualMovementApi.get).mockResolvedValue({
    summary: manualSummary,
    lines: [{
      id: 'a4700000-0000-4000-8000-000000000005',
      lineNumber: 1,
      skuId: 'a4700000-0000-4000-8000-000000000003',
      skuBusinessCode: 'SKU-A',
      skuName: '商品 A',
      locationId: 'a4700000-0000-4000-8000-000000000004',
      locationBusinessCode: 'A-01',
      locationName: '拣货位 A-01',
      quantity: 3,
      actualQuantity: 3,
      amount: 30,
      currency: 'CNY',
      extensionAttributes: {},
    }],
    boxes: [],
    contactInformation: {},
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InboundOutboundDocumentsPage', () => {
  it('bounds shareable query state and serializes only supported filters', () => {
    expect(parseInboundOutboundDocumentsQuery(
      '?direction=bad&status=posted&warehouseId=unsafe&start=2026-08-02&end=2026-08-01&page=-2&size=999',
    )).toEqual(expect.objectContaining({
      direction: 'INBOUND',
      status: 'POSTED',
      warehouseId: undefined,
      start: '2026-08-02',
      end: undefined,
      page: 0,
      size: 25,
    }))
    expect(toInboundOutboundDocumentsUrl({
      direction: 'OUTBOUND',
      status: 'DRAFT',
      keyword: 'MO-1',
      page: 1,
      size: 50,
    })).toBe(
      '/warehouses/documents?direction=OUTBOUND&status=DRAFT&keyword=MO-1&page=1&size=50',
    )
  })

  it('loads the inbound contract and opens a real document detail', async () => {
    render(<InboundOutboundDocumentsPage />)

    expect(await screen.findByText('MI-20260802-001')).toBeTruthy()
    expect(warehouseDocumentApi.list).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'INBOUND',
        searchField: 'DOCUMENT_NO',
        page: 0,
        size: 25,
      }),
    )
    expect(screen.queryByRole('columnheader', { name: '物流信息' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: '头程费' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(await screen.findByRole('dialog', { name: 'MI-20260802-001' })).toBeTruthy()
    expect(await screen.findByRole('table', { name: '单据商品明细' })).toBeTruthy()
    expect(screen.getByText('SKU-A')).toBeTruthy()
  })

  it('keeps direction and supported filters in the route', async () => {
    render(<InboundOutboundDocumentsPage />)
    await screen.findByText('MI-20260802-001')

    fireEvent.click(screen.getByRole('tab', { name: '出库单' }))
    expect(routerState.push).toHaveBeenCalledWith(
      '/warehouses/documents?direction=OUTBOUND',
    )

    fireEvent.change(screen.getByLabelText('单据状态'), {
      target: { value: 'POSTED' },
    })
    fireEvent.change(screen.getByLabelText('搜索内容'), {
      target: { value: ' MI-100 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(routerState.push).toHaveBeenLastCalledWith(
      '/warehouses/documents?status=POSTED&keyword=MI-100',
    )
  })

  it('opens a procurement receipt in its authoritative purchase-order detail', async () => {
    const purchaseOrderId = 'a4700000-0000-4000-8000-000000000009'
    vi.mocked(warehouseDocumentApi.list).mockResolvedValue({
      items: [{
        ...documentSummary,
        id: 'a4700000-0000-4000-8000-000000000008',
        relatedDocumentId: purchaseOrderId,
        source: 'PROCUREMENT_RECEIPT',
        documentNo: 'PO-20260802-001',
        documentType: '采购签收入库',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    render(<InboundOutboundDocumentsPage />)
    expect(await screen.findByText('PO-20260802-001')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看来源' }))

    expect(routerState.push).toHaveBeenCalledWith(
      `/procurement/orders?detailId=${purchaseOrderId}`,
    )
  })

  it('opens an order fulfillment outbound document in its authoritative order detail', async () => {
    const orderId = 'a4700000-0000-4000-8000-000000000010'
    vi.mocked(warehouseDocumentApi.list).mockResolvedValue({
      items: [{
        ...documentSummary,
        id: 'a4700000-0000-4000-8000-000000000011',
        relatedDocumentId: orderId,
        source: 'ORDER_FULFILLMENT',
        direction: 'OUTBOUND',
        documentNo: 'ORDER-20260802-001',
        documentType: '订单履约出库',
        approvalStatus: 'NOT_REQUIRED',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    render(<InboundOutboundDocumentsPage />)
    expect(await screen.findByText('ORDER-20260802-001')).toBeTruthy()
    expect(screen.getByRole('option', { name: '订单履约出库' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看来源' }))

    expect(routerState.push).toHaveBeenCalledWith(
      `/orders/${orderId}?page=0&size=25`,
    )
  })

  it('opens an inventory count document in the filtered count source page', async () => {
    vi.mocked(warehouseDocumentApi.list).mockResolvedValue({
      items: [{
        ...documentSummary,
        id: 'a4700000-0000-4000-8000-000000000012',
        relatedDocumentId: 'a4700000-0000-4000-8000-000000000013',
        source: 'INVENTORY_COUNT',
        status: 'PARTIALLY_REVERSED',
        documentNo: 'IC-20260802-001',
        documentType: '库存盘盈入库',
        approvalStatus: 'APPROVED',
        sourceReference: undefined,
        totalAmount: undefined,
        currency: undefined,
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    render(<InboundOutboundDocumentsPage />)
    expect(await screen.findByText('IC-20260802-001')).toBeTruthy()
    expect(screen.getByText('部分冲销', { selector: 'span' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '库存盘点' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看来源' }))

    expect(routerState.push).toHaveBeenCalledWith(
      '/warehouses/counts?searchField=BATCH&keyword=IC-20260802-001&showDetails=true',
    )
  })

  it('announces list errors and offers a working retry', async () => {
    vi.mocked(warehouseDocumentApi.list)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [],
        page: 0,
        size: 25,
        totalElements: 0,
        totalPages: 0,
      })
    render(<InboundOutboundDocumentsPage />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      '暂时无法读取入出库单，请稍后重试。',
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(warehouseDocumentApi.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('没有符合条件的入库单')).toBeTruthy()
  })

  it('exports every row matching the current filter with visible progress', async () => {
    routerState.search = '?source=inventory_count&status=partially_reversed&keyword=IC-1'
    let finishExport: (value: {
      filename: string
      mediaType: 'text/csv;charset=utf-8'
      rowCount: number
      content: string
    }) => void = () => undefined
    vi.mocked(warehouseDocumentApi.exportCsv).mockReturnValue(new Promise((resolve) => {
      finishExport = resolve
    }))
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:documents')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<InboundOutboundDocumentsPage />)
    await screen.findByText('MI-20260802-001')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(screen.getByRole('button', { name: '正在导出…' })).toHaveProperty('disabled', true)
    expect(warehouseDocumentApi.exportCsv).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'INBOUND',
      source: 'INVENTORY_COUNT',
      status: 'PARTIALLY_REVERSED',
      searchField: 'DOCUMENT_NO',
      keyword: 'IC-1',
    }))

    finishExport({
      filename: 'warehouse-documents-inbound.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF单号,单据方向,单据类型\r\nIC-1,入库,库存盘点\r\n',
    })
    expect((await screen.findByRole('status')).textContent).toContain(
      '已导出 1 条入库单。',
    )
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:documents')
  })

  it('announces an oversized export and keeps the retry action available', async () => {
    vi.mocked(warehouseDocumentApi.exportCsv).mockRejectedValue(
      new ApiError('conflict', { status: 409 }),
    )
    render(<InboundOutboundDocumentsPage />)
    await screen.findByText('MI-20260802-001')

    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      '导出结果超过 10,000 条，请缩小筛选范围后重试。',
    )
    expect(screen.getByRole('button', { name: '导出筛选结果' })).toHaveProperty('disabled', false)
  })
})
