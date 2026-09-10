import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { inventoryApi } from '../modules/inventoryApi'
import { inventoryTransferApi } from '../modules/inventoryTransferApi'
import { warehouseCenterApi } from '../modules/warehouseCenterApi'
import { WarehouseTransferPage } from './WarehouseTransferPage'

const routerState = vi.hoisted(() => ({ search: '?tab=APPROVAL', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: { push: routerState.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }) }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/inventoryTransferApi', async () => { const actual = await vi.importActual<typeof import('../modules/inventoryTransferApi')>('../modules/inventoryTransferApi'); return { ...actual, inventoryTransferApi: { list: vi.fn(), exportCsv: vi.fn(), get: vi.fn(), create: vi.fn(), transition: vi.fn(), receivePartial: vi.fn() } } })
vi.mock('../modules/inventoryApi', async () => { const actual = await vi.importActual<typeof import('../modules/inventoryApi')>('../modules/inventoryApi'); return { ...actual, inventoryApi: { ...actual.inventoryApi, listBalances: vi.fn() } } })
vi.mock('../modules/warehouseCenterApi', async () => { const actual = await vi.importActual<typeof import('../modules/warehouseCenterApi')>('../modules/warehouseCenterApi'); return { ...actual, warehouseCenterApi: { ...actual.warehouseCenterApi, listWarehouses: vi.fn() } } })

const sourceWarehouseId = 'a2000000-0000-4000-8000-000000000001'
const targetWarehouseId = 'a3000000-0000-4000-8000-000000000001'
const transferId = 'a1000000-0000-4000-8000-000000000001'
const balanceId = 'a4000000-0000-4000-8000-000000000001'
const summary = {
  id: transferId, transferNo: 'WT-20260801-A1000000', status: 'APPROVAL' as const, transferDate: '2026-08-01',
  sourceWarehouseId, sourceWarehouseCode: 'WH-1', sourceWarehouseName: '主仓', targetWarehouseId, targetWarehouseCode: 'WH-2', targetWarehouseName: '分仓',
  transportMode: 'LAND' as const, allocationMethod: 'WEIGHT' as const, lineCount: 1, totalQuantity: 4, version: 1, operatorDisplayName: '操作员',
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
}
const detail = { summary, lines: [{ id: 'a7000000-0000-4000-8000-000000000001', sourceBalanceId: balanceId, skuId: 'a8000000-0000-4000-8000-000000000001', skuCode: 'SKU-1', skuName: '商品一', snapshotBalanceVersion: 3, snapshotOnHand: 10, snapshotReserved: 1, snapshotAvailable: 9, quantity: 4, receivedQuantity: 0, remainingQuantity: 4 }] }
const warehouses = [
  { id: sourceWarehouseId, businessCode: 'WH-1', name: '主仓', status: 'ACTIVE' as const, version: 1, createdAt: summary.createdAt, updatedAt: summary.updatedAt },
  { id: targetWarehouseId, businessCode: 'WH-2', name: '分仓', status: 'ACTIVE' as const, version: 1, createdAt: summary.createdAt, updatedAt: summary.updatedAt },
]
const balance = { id: balanceId, skuId: detail.lines[0].skuId, skuBusinessCode: 'SKU-1', skuName: '商品一', warehouseId: sourceWarehouseId, warehouseBusinessCode: 'WH-1', warehouseName: '主仓', onHand: 10, reserved: 1, available: 9, version: 3, updatedAt: summary.updatedAt }

describe('WarehouseTransferPage', () => {
  beforeEach(() => {
    routerState.search = '?tab=APPROVAL'; routerState.push.mockReset(); vi.stubGlobal('crypto', { randomUUID: () => 'a5000000-0000-4000-8000-000000000001' })
    vi.mocked(inventoryTransferApi.list).mockReset().mockResolvedValue({ items: [summary], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    vi.mocked(inventoryTransferApi.exportCsv).mockReset().mockResolvedValue({ filename: 'warehouse-transfers.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, content: '\uFEFF调拨批次,状态,调拨日期,起始仓库编码,起始仓库名称,目标仓库编码,目标仓库名称,运输方式,SKU个数,调拨数量,物流渠道,跟踪号,运费金额(最小货币单位),货币,计费方式,预计发货时间,预计到货时间,备注,操作人,审批人,发货人,签收人,创建时间,更新时间\r\n' })
    vi.mocked(inventoryTransferApi.get).mockReset().mockResolvedValue(detail)
    vi.mocked(inventoryTransferApi.transition).mockReset().mockResolvedValue({ ...detail, summary: { ...summary, status: 'READY_TO_SHIP', version: 2, approverDisplayName: '审核员' } })
    vi.mocked(inventoryTransferApi.receivePartial).mockReset().mockResolvedValue({ ...detail, summary: { ...summary, status: 'PARTIALLY_RECEIVED', version: 2 }, lines: [{ ...detail.lines[0], receivedQuantity: 2, remainingQuantity: 2 }] })
    vi.mocked(inventoryTransferApi.create).mockReset().mockResolvedValue(detail)
    vi.mocked(warehouseCenterApi.listWarehouses).mockReset().mockResolvedValue({ items: warehouses, page: 0, size: 200, totalElements: 2, totalPages: 1 })
    vi.mocked(inventoryApi.listBalances).mockReset().mockResolvedValue({ items: [balance], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('loads the approval queue and approves a transfer after confirmation', async () => {
    render(<WarehouseTransferPage />)
    expect(await screen.findByText('WT-20260801-A1000000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '调拨设置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '批量操作' })).toBeNull()
    expect(screen.queryByRole('button', { name: '排序' })).toBeNull()
    expect(inventoryTransferApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVAL' }))
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    expect(await screen.findByRole('table', { name: '调拨商品明细' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }))
    const confirmation = await screen.findByRole('alertdialog', { name: '审核通过' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认通过' }))
    await waitFor(() => expect(inventoryTransferApi.transition).toHaveBeenCalledWith(transferId, 'approve', 1, 'a5000000-0000-4000-8000-000000000001'))
    expect(await screen.findByText('审核员')).toBeTruthy()
  })

  it('shows the concrete inventory conflict when shipment cannot continue', async () => {
    vi.mocked(inventoryTransferApi.get).mockResolvedValue({
      ...detail,
      summary: { ...summary, status: 'READY_TO_SHIP', version: 2 },
    })
    vi.mocked(inventoryTransferApi.transition).mockRejectedValue(new ApiError(
      'conflict',
      { status: 409, details: { reason: 'stale_version' } },
    ))
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认发货' }))
    const confirmation = await screen.findByRole('alertdialog', { name: '确认发货' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认发货' }))

    expect((await screen.findByRole('alert')).textContent).toBe('起始仓库存已更新，请重新打开调拨详情后重试。')
  })

  it('creates a submitted transfer from authoritative source balances', async () => {
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '新增调拨' }))
    fireEvent.change(await screen.findByLabelText('* 起始仓库'), { target: { value: sourceWarehouseId } })
    fireEvent.change(screen.getByLabelText('* 目标仓库'), { target: { value: targetWarehouseId } })
    fireEvent.change(await screen.findByLabelText('SKU-1 调拨数量'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并提交调拨' }))
    await waitFor(() => expect(inventoryTransferApi.create).toHaveBeenCalledWith(expect.objectContaining({ sourceWarehouseId, targetWarehouseId, submit: true, lines: [{ balanceId, quantity: 4 }] })))
  })

  it('blocks an invalid freight currency before creating a transfer', async () => {
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '新增调拨' }))
    fireEvent.change(await screen.findByLabelText('* 起始仓库'), { target: { value: sourceWarehouseId } })
    fireEvent.change(screen.getByLabelText('* 目标仓库'), { target: { value: targetWarehouseId } })
    fireEvent.change(await screen.findByLabelText('SKU-1 调拨数量'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('运费（最小货币单位）'), { target: { value: '100' } })
    fireEvent.change(screen.getByPlaceholderText('选择或输入 ISO 三位币种'), { target: { value: 'XY' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并提交调拨' }))

    expect(await screen.findByText('币种须为 ISO 三位代码，例如 CNY。')).toBeTruthy()
    expect(inventoryTransferApi.create).not.toHaveBeenCalled()
  })

  it('loads every stable active warehouse page for transfer creation', async () => {
    vi.mocked(warehouseCenterApi.listWarehouses).mockImplementation(async (request) => request.page === 0
      ? { items: [warehouses[0]], page: 0, size: 200, totalElements: 2, totalPages: 2 }
      : { items: [warehouses[1]], page: 1, size: 200, totalElements: 2, totalPages: 2 })

    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '新增调拨' }))

    const target = await screen.findByLabelText<HTMLSelectElement>('* 目标仓库')
    expect(within(target).getByRole('option', { name: '分仓 · WH-2' })).toBeTruthy()
    expect(warehouseCenterApi.listWarehouses).toHaveBeenCalledWith({ status: 'ACTIVE', page: 1, size: 200 })
  })

  it('keeps quantities across source balance pages and submits all selected rows', async () => {
    const secondBalance = {
      ...balance,
      id: 'a4000000-0000-4000-8000-000000000002',
      skuId: 'a8000000-0000-4000-8000-000000000002',
      skuBusinessCode: 'SKU-2',
      skuName: '商品二',
      onHand: 8,
      reserved: 0,
      available: 8,
    }
    vi.mocked(inventoryApi.listBalances).mockImplementation(async (request) => request.page === 0
      ? { items: [balance], page: 0, size: 200, totalElements: 201, totalPages: 2 }
      : { items: [secondBalance], page: 1, size: 200, totalElements: 201, totalPages: 2 })

    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '新增调拨' }))
    fireEvent.change(await screen.findByLabelText('* 起始仓库'), { target: { value: sourceWarehouseId } })
    fireEvent.change(screen.getByLabelText('* 目标仓库'), { target: { value: targetWarehouseId } })
    fireEvent.change(await screen.findByLabelText('SKU-1 调拨数量'), { target: { value: '4' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '调拨商品分页' })).getByRole('button', { name: '下一页' }))
    fireEvent.change(await screen.findByLabelText('SKU-2 调拨数量'), { target: { value: '3' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '调拨商品分页' })).getByRole('button', { name: '上一页' }))
    expect((await screen.findByLabelText('SKU-1 调拨数量') as HTMLInputElement).value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: '保存并提交调拨' }))

    await waitFor(() => expect(inventoryTransferApi.create).toHaveBeenCalledWith(expect.objectContaining({
      sourceWarehouseId,
      targetWarehouseId,
      submit: true,
      lines: [
        { balanceId, quantity: 4 },
        { balanceId: secondBalance.id, quantity: 3 },
      ],
    })))
    expect(inventoryApi.listBalances).toHaveBeenNthCalledWith(1, { warehouseId: sourceWarehouseId, page: 0, size: 200 })
    expect(inventoryApi.listBalances).toHaveBeenNthCalledWith(2, { warehouseId: sourceWarehouseId, page: 1, size: 200 })
  })

  it('records an explicit partial receipt without closing the transfer', async () => {
    vi.mocked(inventoryTransferApi.get).mockResolvedValue({
      ...detail,
      summary: { ...summary, status: 'IN_TRANSIT', version: 3 },
      lines: [{ ...detail.lines[0], shipmentEventId: 'a6000000-0000-4000-8000-000000000001' }],
    })
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    fireEvent.click(await screen.findByRole('button', { name: '部分签收' }))
    fireEvent.change(screen.getByLabelText('SKU-1 本次签收数量'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '确认本次签收' }))

    await waitFor(() => expect(inventoryTransferApi.receivePartial).toHaveBeenCalledWith(
      transferId,
      3,
      'a5000000-0000-4000-8000-000000000001',
      [{ lineId: detail.lines[0].id, quantity: 2 }],
    ))
  })

  it('downloads the current receipt queue and announces success', async () => {
    routerState.search = `?tab=RECEIPT&searchField=SKU&keyword=SKU-1&originWarehouse=${sourceWarehouseId}&targetWarehouse=${targetWarehouseId}&transport=LAND&start=2026-07-01&end=2026-08-01`
    vi.mocked(inventoryTransferApi.list).mockResolvedValue({
      items: [summary], page: 0, size: 50, totalElements: 1, totalPages: 1,
    })
    const createObjectURL = vi.fn(() => 'blob:warehouse-transfers')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')

    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(await screen.findByText('已导出 1 条分仓调拨。')).toBeTruthy()
    expect(inventoryTransferApi.exportCsv).toHaveBeenCalledWith({
      sourceWarehouseId, targetWarehouseId,
      statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'],
      transportMode: 'LAND', searchField: 'SKU', keyword: 'SKU-1',
      from: '2026-07-01', to: '2026-08-01',
    })
    expect(createObjectURL).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:warehouse-transfers')
  })

  it('announces a recovery message when the export is too large', async () => {
    vi.mocked(inventoryTransferApi.exportCsv).mockRejectedValue(new ApiError('hidden', { status: 409 }))
    render(<WarehouseTransferPage />)
    await screen.findByText('WT-20260801-A1000000')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))
    expect((await screen.findByRole('alert')).textContent).toBe('导出结果超过 10,000 条，请缩小筛选范围后重试。')
  })

  it('rejects the legacy WMS query and keeps partially received transfers in the default receipt queue', async () => {
    routerState.search = '?tab=WMS'
    const partialSummary = { ...summary, status: 'PARTIALLY_RECEIVED' as const }
    vi.mocked(inventoryTransferApi.list).mockResolvedValue({
      items: [partialSummary], page: 0, size: 50,
      totalElements: 1, totalPages: 1,
    })

    render(<WarehouseTransferPage />)

    expect(screen.queryByRole('tab', { name: '转 WMS 发货' })).toBeNull()
    expect(await screen.findByText('部分签收')).toBeTruthy()
    expect(inventoryTransferApi.list).toHaveBeenCalledOnce()
    expect(inventoryTransferApi.list).toHaveBeenCalledWith(expect.objectContaining({
      status: undefined,
      statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'],
    }))
  })

  it('loads and navigates a unified receipt queue page', async () => {
    routerState.search = '?tab=RECEIPT&page=1&size=20'
    vi.mocked(inventoryTransferApi.list).mockResolvedValue({
      items: [summary], page: 1, size: 20, totalElements: 45, totalPages: 3,
    })

    render(<WarehouseTransferPage />)

    expect(await screen.findByText('共 45 条 · 第 2 / 3 页')).toBeTruthy()
    expect(inventoryTransferApi.list).toHaveBeenCalledWith(expect.objectContaining({
      statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'], page: 1, size: 20,
    }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(routerState.push).toHaveBeenLastCalledWith(
      '/warehouses/transfers?tab=RECEIPT&searchField=BATCH&page=2&size=20',
    )
  })
})
