import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ProcurementLedgerPage, parseProcurementLedgerQuery, toProcurementLedgerUrl } from './ProcurementLedgerPage'

const state = vi.hoisted(() => ({
  search: '', push: vi.fn(), list: vi.fn(), exportLedgerCsv: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: state.push } }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: { searchStr: state.search } }),
}))

vi.mock('../modules/procurementReceiptApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementReceiptApi')>()
  return {
    ...actual,
    procurementReceiptApi: {
      ...actual.procurementReceiptApi,
      list: state.list,
      exportLedgerCsv: state.exportLedgerCsv,
    },
  }
})

const receipt = {
  receiptId: '22222222-2222-4222-8222-222222222222',
  purchaseOrderId: '11111111-1111-4111-8111-111111111111',
  purchaseNo: 'PO-1',
  planNo: 'PP-1',
  supplierId: '33333333-3333-4333-8333-333333333333',
  supplierCode: 'SUP-1',
  supplierName: '供应商',
  skuId: '44444444-4444-4444-8444-444444444444',
  skuCode: 'SKU-1',
  skuName: '商品',
  warehouseId: '55555555-5555-4555-8555-555555555555',
  warehouseCode: 'WH-1',
  warehouseName: '主仓',
  locationId: '66666666-6666-4666-8666-666666666666',
  locationCode: 'A-1',
  locationName: 'A区',
  quantity: 5,
  inventoryEventId: '77777777-7777-4777-8777-777777777777',
  inventoryLedgerSequence: 9,
  inventoryBalanceAfter: 25,
  receivedByDisplayName: 'Operator',
  receivedAt: '2026-08-02T12:00:00Z',
}

beforeEach(() => {
  state.search = ''
  state.push.mockReset()
  state.list.mockReset()
  state.list.mockResolvedValue({ items: [receipt], page: 0, size: 50, totalElements: 1, totalPages: 1 })
  state.exportLedgerCsv.mockReset().mockResolvedValue({
    filename: 'procurement-receipt-ledger.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 1,
    content: '\uFEFF入库时间,采购单号,计划编号,供应商编码,供应商名称,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,本次入库,入库后库存,库存事件序号,库存事件ID,操作人\r\n',
  })
})

afterEach(cleanup)

describe('procurement ledger page', () => {
  it('bounds and serializes supported receipt query facts', () => {
    expect(parseProcurementLedgerQuery('?dimension=UNKNOWN&startDate=bad&showProductDetails=true')).toMatchObject({
      dimension: 'INBOUND_TIME', startDate: '', showProductDetails: true, page: 0, size: 50,
    })
    expect(toProcurementLedgerUrl({ dimension: 'INVENTORY_SKU', purchaseKeyword: ' PO-1 ', supplierKeyword: ' 供应商A ', showProductDetails: true }))
      .toBe('/procurement/statistics/ledger?dimension=INVENTORY_SKU&purchaseKeyword=PO-1&supplierKeyword=%E4%BE%9B%E5%BA%94%E5%95%86A&showProductDetails=true')
  })

  it('renders real receipt facts without invented amount or quality columns', async () => {
    render(<ProcurementLedgerPage />)
    const table = await screen.findByRole('table', { name: '采购收货流水' })
    expect(within(table).getByText('PO-1')).toBeTruthy()
    expect(within(table).getByText('25')).toBeTruthy()
    fireEvent.click(within(table).getByRole('button', { name: '采购单详情' }))
    expect(state.push).toHaveBeenCalledWith(`/procurement/orders?detailId=${receipt.purchaseOrderId}`)
    expect(screen.queryByRole('columnheader', { name: '金额' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: '质检结果' })).toBeNull()
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({ sort: 'RECEIVED_AT', page: 0, size: 50 })))
  })

  it('serializes interactive filters', () => {
    render(<ProcurementLedgerPage />)
    fireEvent.click(screen.getByLabelText('按采购单号'))
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-04-01' } })
    fireEvent.change(screen.getByLabelText('采购单 / 计划号'), { target: { value: ' PO-2 ' } })
    fireEvent.change(screen.getByLabelText('供应商关键字'), { target: { value: ' 供应商B ' } })
    fireEvent.click(screen.getByLabelText('显示商品详情'))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(state.push).toHaveBeenCalledWith('/procurement/statistics/ledger?dimension=PURCHASE_ORDER&startDate=2026-04-01&purchaseKeyword=PO-2&supplierKeyword=%E4%BE%9B%E5%BA%94%E5%95%86B&showProductDetails=true')
  })

  it('rejects an inverted receipt date range before navigation', () => {
    render(<ProcurementLedgerPage />)
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-08-02' } })
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('alert').textContent).toContain('起始日期不能晚于截止日期')
    expect(state.push).not.toHaveBeenCalled()
  })

  it('returns an obsolete page link to the last available ledger page', async () => {
    state.search = '?page=9&size=25'
    state.list.mockResolvedValue({ items: [], page: 9, size: 25, totalElements: 26, totalPages: 2 })
    render(<ProcurementLedgerPage />)
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/procurement/statistics/ledger?page=1&size=25'))
  })

  it('downloads the current receipt filters and announces success', async () => {
    state.search = '?dimension=INVENTORY_SKU&startDate=2026-08-01&endDate=2026-08-02&purchaseKeyword=PO-1&supplierKeyword=Supplier&showProductDetails=true'
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:procurement-receipt-ledger'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<ProcurementLedgerPage />)
    fireEvent.click(await screen.findByRole('button', {
      name: '导出筛选结果',
    }))

    await waitFor(() => expect(state.exportLedgerCsv).toHaveBeenCalledWith({
      sort: 'SKU_CODE',
      purchaseKeyword: 'PO-1',
      supplierKeyword: 'Supplier',
      receivedFrom: '2026-08-01T00:00:00.000Z',
      receivedTo: '2026-08-02T23:59:59.999Z',
    }))
    expect(await screen.findByText('已导出 1 条采购流水。')).toBeTruthy()
  })

  it('announces an oversized export and permits retry', async () => {
    state.exportLedgerCsv.mockRejectedValueOnce(
      new ApiError('hidden', { status: 409 }),
    )
    render(<ProcurementLedgerPage />)

    fireEvent.click(await screen.findByRole('button', {
      name: '导出筛选结果',
    }))

    expect((await screen.findByRole('alert')).textContent)
      .toContain('超过 10,000 条')
    expect(screen.getByRole('button', { name: '导出筛选结果' }))
      .toHaveProperty('disabled', false)
  })
})
