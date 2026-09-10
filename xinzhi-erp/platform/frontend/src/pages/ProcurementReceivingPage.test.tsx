import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ProcurementReceivingPage, parseProcurementReceivingQuery, toProcurementReceiptLedgerUrl, toProcurementReceivingUrl } from './ProcurementReceivingPage'

const state = vi.hoisted(() => ({ search: '', push: vi.fn(), list: vi.fn(), get: vi.fn(), receive: vi.fn(), exportCsv: vi.fn(), receipts: vi.fn(), canWrite: true }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: state.push } }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: { searchStr: state.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => permission === 'procurement.write' && state.canWrite }) }))
vi.mock('../modules/procurementOrderApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementOrderApi')>()
  return { ...actual, procurementOrderApi: { ...actual.procurementOrderApi, list: state.list, get: state.get, receive: state.receive, exportCsv: state.exportCsv } }
})
vi.mock('../modules/procurementReceiptApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementReceiptApi')>()
  return { ...actual, procurementReceiptApi: { ...actual.procurementReceiptApi, forOrder: state.receipts } }
})

const order = {
  purchaseOrderId: '11111111-1111-4111-8111-111111111111', purchaseNo: 'PO-20260802-ABC', status: 'APPROVED' as const,
  planId: '22222222-2222-4222-8222-222222222222', planNo: 'PP-20260802-ABC', supplierId: '33333333-3333-4333-8333-333333333333', supplierCode: 'SUP-1', supplierName: '供应商',
  skuId: '44444444-4444-4444-8444-444444444444', skuCode: 'SKU-1', skuName: '商品', warehouseId: '55555555-5555-4555-8555-555555555555', warehouseCode: 'WH-1', warehouseName: '主仓',
  locationId: '66666666-6666-4666-8666-666666666666', locationCode: 'A-01', locationName: 'A区', quantity: 12, receivedQuantity: 0, orderedByDisplayName: 'Operator', reviewDecision: 'APPROVED' as const, reviewedByDisplayName: 'Reviewer', reviewedAt: '2026-08-02T10:30:00Z', version: 1, createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-02T10:30:00Z',
}

beforeEach(() => {
  state.search = ''; state.canWrite = true; state.push.mockReset(); state.list.mockReset(); state.get.mockReset(); state.receive.mockReset(); state.exportCsv.mockReset(); state.receipts.mockReset()
  state.list.mockResolvedValue({ items: [order], page: 0, size: 50, totalElements: 1, totalPages: 1 })
  state.get.mockResolvedValue(order)
  state.exportCsv.mockResolvedValue({ filename: 'procurement-orders.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, content: '\uFEFF采购单号,状态\r\nPO-1,待收货\r\n' })
  state.receipts.mockResolvedValue({ items: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
})
afterEach(cleanup)

describe('procurement receiving page', () => {
  it('bounds and serializes the purchase number query', () => {
    expect(parseProcurementReceivingQuery(`?code=%20${'A'.repeat(140)}%20&orderId=invalid&page=-1&size=500`)).toEqual({ code: 'A'.repeat(120), orderId: '', page: 0, size: 50 })
    expect(toProcurementReceivingUrl({ code: ' PO / 2026-01 ' })).toBe('/procurement/receiving?code=PO+%2F+2026-01')
    expect(toProcurementReceiptLedgerUrl(' PO / 2026-01 ')).toBe('/procurement/statistics/ledger?dimension=PURCHASE_ORDER&purchaseKeyword=PO+%2F+2026-01')
  })

  it('opens a canonical receipt workspace directly from a validated order link', async () => {
    state.search = `?code=${order.purchaseNo}&orderId=${order.purchaseOrderId}`
    render(<ProcurementReceivingPage />)
    expect(await screen.findByRole('heading', { name: '采购单收货' })).toBeTruthy()
    expect(state.get).toHaveBeenCalledWith(order.purchaseOrderId)
    await waitFor(() => expect(state.receipts).toHaveBeenCalledWith(order.purchaseOrderId, 0, 50, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(state.push).toHaveBeenCalledWith(`/procurement/receiving?code=${order.purchaseNo}`)
  })

  it('retries a failed direct receipt workspace without discarding its identity', async () => {
    state.search = `?orderId=${order.purchaseOrderId}`
    state.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(order)
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '重试采购单' }))
    expect(await screen.findByRole('heading', { name: '采购单收货' })).toBeTruthy()
    expect(state.get).toHaveBeenCalledTimes(2)
  })

  it('loads purchase orders and posts a bounded receipt', async () => {
    state.receive.mockResolvedValue({ ...order, status: 'PARTIALLY_RECEIVED', receivedQuantity: 5, version: 2, lastReceivedAt: '2026-08-02T11:00:00Z' })
    render(<ProcurementReceivingPage />)
    expect(screen.getByRole('heading', { name: '签收入库' })).toBeTruthy()
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({ receivableOnly: true })))
    await waitFor(() => expect(screen.getByRole('table', { name: '采购收货列表' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '签收入库' }))
    expect(state.push).toHaveBeenCalledWith(`/procurement/receiving?orderId=${order.purchaseOrderId}`)
    await waitFor(() => expect(state.receipts).toHaveBeenCalledWith(order.purchaseOrderId, 0, 50, expect.any(AbortSignal)))
    expect(await screen.findByRole('table', { name: '本单收货记录' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看采购单详情' }))
    expect(state.push).toHaveBeenCalledWith(`/procurement/orders?detailId=${order.purchaseOrderId}`)
    fireEvent.change(screen.getByLabelText('本次收货数量'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '确认签收入库' }))
    await waitFor(() => expect(state.receive).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: order.purchaseOrderId, expectedVersion: 1, quantity: 5 })))
    expect(await screen.findByText('12 / 5 / 7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看该单采购流水' }))
    expect(state.push).toHaveBeenCalledWith('/procurement/statistics/ledger?dimension=PURCHASE_ORDER&purchaseKeyword=PO-20260802-ABC')
  })

  it('removes a fully received order from the actionable queue and reloads it', async () => {
    const received = { ...order, status: 'RECEIVED' as const, receivedQuantity: 12, version: 2, lastReceivedAt: '2026-08-02T11:00:00Z', updatedAt: '2026-08-02T11:00:00Z' }
    state.receive.mockResolvedValue(received)
    state.list.mockResolvedValueOnce({ items: [order], page: 0, size: 50, totalElements: 1, totalPages: 1 })
      .mockResolvedValueOnce({ items: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    fireEvent.click(screen.getByRole('button', { name: '确认签收入库' }))
    expect(await screen.findByText('该采购单已全部收货')).toBeTruthy()
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2))
    expect(within(screen.getByRole('table', { name: '采购收货列表' })).queryByText(order.purchaseNo)).toBeNull()
  })

  it('keeps a fully received order visible in an explicit purchase-number search', async () => {
    state.search = `?code=${order.purchaseNo}`
    state.receive.mockResolvedValue({ ...order, status: 'RECEIVED' as const, receivedQuantity: 12, version: 2, lastReceivedAt: '2026-08-02T11:00:00Z', updatedAt: '2026-08-02T11:00:00Z' })
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    fireEvent.click(screen.getByRole('button', { name: '确认签收入库' }))
    expect(await screen.findByText('12 / 12 / 0')).toBeTruthy()
    expect(state.list).toHaveBeenCalledTimes(1)
  })

  it('lets read-only users inspect receipts without exposing the write form', async () => {
    state.canWrite = false
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '查看记录' }))
    expect(await screen.findByRole('table', { name: '本单收货记录' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '确认签收入库' })).toBeNull()
  })

  it('searches all receipt states when a purchase number is supplied', async () => {
    state.search = '?code=PO-20260802-ABC'
    render(<ProcurementReceivingPage />)
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({
      keyword: 'PO-20260802-ABC', receivableOnly: undefined,
    })))
  })

  it('exports the current receiving queue and announces success', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:procurement-receiving')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect(state.exportCsv).toHaveBeenCalledWith({
      searchField: 'PURCHASE_NO', keyword: undefined, receivableOnly: true,
    })
    expect(await screen.findByText('已导出 1 条采购收货记录。')).toBeTruthy()
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:procurement-receiving')
  })

  it('exports all receipt states for a purchase-number search and explains large results', async () => {
    state.search = `?code=${order.purchaseNo}`
    state.exportCsv.mockRejectedValue(new ApiError('too many', { status: 409 }))
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect(state.exportCsv).toHaveBeenCalledWith({
      searchField: 'PURCHASE_NO', keyword: order.purchaseNo, receivableOnly: undefined,
    })
    expect((await screen.findByRole('alert')).textContent).toContain('请使用更精确的采购单号后重试')
    expect(screen.getByRole('button', { name: '导出筛选结果' })).not.toHaveProperty('disabled', true)
  })

  it('keeps server paging in the URL and loads the requested queue page', async () => {
    state.search = '?page=1&size=25'
    state.list.mockResolvedValue({ items: [order], page: 1, size: 25, totalElements: 60, totalPages: 3 })
    render(<ProcurementReceivingPage />)
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 1, size: 25, receivableOnly: true,
    })))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(state.push).toHaveBeenCalledWith('/procurement/receiving?page=2&size=25')
    fireEvent.change(screen.getByLabelText('每页'), { target: { value: '100' } })
    expect(state.push).toHaveBeenCalledWith('/procurement/receiving?size=100')
  })

  it('returns an obsolete page link to the last available receiving page', async () => {
    state.search = '?page=9&size=25'
    state.list.mockResolvedValue({ items: [], page: 9, size: 25, totalElements: 26, totalPages: 2 })
    render(<ProcurementReceivingPage />)
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/procurement/receiving?page=1&size=25'))
  })

  it('paginates all receipt history for one purchase order', async () => {
    state.receipts.mockResolvedValue({ items: [], page: 0, size: 50, totalElements: 51, totalPages: 2 })
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    await waitFor(() => expect(state.receipts).toHaveBeenCalledWith(order.purchaseOrderId, 0, 50, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: '下一页收货记录' }))
    await waitFor(() => expect(state.receipts).toHaveBeenCalledWith(order.purchaseOrderId, 1, 50, expect.any(AbortSignal)))
  })

  it('reloads the latest order after a concurrent receipt conflict', async () => {
    const latest = { ...order, status: 'PARTIALLY_RECEIVED' as const, receivedQuantity: 5, version: 2, lastReceivedAt: '2026-08-02T11:00:00Z', updatedAt: '2026-08-02T11:00:00Z' }
    state.receive.mockRejectedValue(new ApiError('conflict', { status: 409, details: { reason: 'receipt_quantity_exceeds_remaining' } }))
    state.get.mockResolvedValue(latest)
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    fireEvent.click(screen.getByRole('button', { name: '确认签收入库' }))
    expect(await screen.findByText('本次收货数量超过待收数量，请重新填写。')).toBeTruthy()
    await waitFor(() => expect(state.get).toHaveBeenCalledWith(order.purchaseOrderId))
    await waitFor(() => expect((screen.getByLabelText('本次收货数量') as HTMLInputElement).value).toBe('7'))
    expect(screen.getByText('12 / 5 / 7')).toBeTruthy()
    await waitFor(() => expect(state.receipts).toHaveBeenCalledTimes(2))
  })

  it('closes the stale receipt form when conflict recovery cannot reload the order', async () => {
    state.receive.mockRejectedValue(new ApiError('conflict', { status: 409, details: { reason: 'optimistic_lock_conflict' } }))
    state.get.mockRejectedValue(new Error('offline'))
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    fireEvent.click(screen.getByRole('button', { name: '确认签收入库' }))
    await waitFor(() => expect(state.get).toHaveBeenCalledWith(order.purchaseOrderId))
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认签收入库' })).toBeNull())
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2))
  })

  it('retries receipt history without closing the selected order', async () => {
    state.receipts.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    render(<ProcurementReceivingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '签收入库' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试收货记录' }))
    expect(await screen.findByRole('table', { name: '本单收货记录' })).toBeTruthy()
    expect(state.receipts).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '确认签收入库' })).toBeTruthy()
  })
})
