import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inventoryApi } from '../modules/inventoryApi'
import { inventoryCountApi } from '../modules/inventoryCountApi'
import { ApiError } from '../api/client'
import { warehouseCenterApi } from '../modules/warehouseCenterApi'
import { buildInventoryCountLines, InventoryCountPage } from './InventoryCountPage'

const routerState = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: { push: routerState.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }) }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/inventoryCountApi', async () => { const actual = await vi.importActual<typeof import('../modules/inventoryCountApi')>('../modules/inventoryCountApi'); return { ...actual, inventoryCountApi: { list: vi.fn(), exportCsv: vi.fn(), get: vi.fn(), create: vi.fn(), transition: vi.fn() } } })
vi.mock('../modules/inventoryApi', async () => { const actual = await vi.importActual<typeof import('../modules/inventoryApi')>('../modules/inventoryApi'); return { ...actual, inventoryApi: { ...actual.inventoryApi, listBalances: vi.fn() } } })
vi.mock('../modules/warehouseCenterApi', async () => { const actual = await vi.importActual<typeof import('../modules/warehouseCenterApi')>('../modules/warehouseCenterApi'); return { ...actual, warehouseCenterApi: { ...actual.warehouseCenterApi, listWarehouses: vi.fn() } } })

const warehouseId = '92000000-0000-4000-8000-000000000001'
const countId = '91000000-0000-4000-8000-000000000001'
const balanceId = '93000000-0000-4000-8000-000000000001'
const summary = { id: countId, countNo: 'IC-20260801-91000000', warehouseId, warehouseCode: 'WH-1', warehouseName: '主仓', status: 'APPROVAL' as const, countDate: '2026-08-01', lineCount: 1, totalDifference: 2, version: 1, operatorDisplayName: '操作员', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
const detail = { summary, lines: [{ id: '95000000-0000-4000-8000-000000000001', balanceId, skuId: '96000000-0000-4000-8000-000000000001', skuCode: 'SKU-1', skuName: '商品一', expectedBalanceVersion: 3, snapshotOnHand: 10, snapshotReserved: 1, snapshotAvailable: 9, countedOnHand: 12, difference: 2 }] }
const warehouse = { id: warehouseId, businessCode: 'WH-1', name: '主仓', status: 'ACTIVE' as const, version: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
const balance = { id: balanceId, skuId: detail.lines[0].skuId, skuBusinessCode: 'SKU-1', skuName: '商品一', warehouseId, warehouseBusinessCode: 'WH-1', warehouseName: '主仓', onHand: 10, reserved: 1, available: 9, version: 3, updatedAt: '2026-08-01T00:00:00Z' }

describe('InventoryCountPage', () => {
  beforeEach(() => {
    routerState.search = ''; routerState.push.mockReset(); vi.stubGlobal('crypto', { randomUUID: () => '94000000-0000-4000-8000-000000000001' })
    vi.mocked(inventoryCountApi.list).mockReset().mockResolvedValue({ items: [summary], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    vi.mocked(inventoryCountApi.exportCsv).mockReset().mockResolvedValue({ filename: 'inventory-counts.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, content: '\uFEFF盘点批次,仓库编码,仓库名称,状态,盘点日期,备注,SKU个数,总差值,操作人,审批人,创建时间,更新时间\r\n' })
    vi.mocked(inventoryCountApi.get).mockReset().mockResolvedValue(detail)
    vi.mocked(inventoryCountApi.transition).mockReset().mockResolvedValue({ ...detail, summary: { ...summary, status: 'COMPLETED', version: 2, approverDisplayName: '审批员' } })
    vi.mocked(inventoryCountApi.create).mockReset().mockResolvedValue(detail)
    vi.mocked(warehouseCenterApi.listWarehouses).mockReset().mockResolvedValue({ items: [warehouse], page: 0, size: 200, totalElements: 1, totalPages: 1 })
    vi.mocked(inventoryApi.listBalances).mockReset().mockResolvedValue({ items: [balance], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('loads a real count batch and approves it after confirmation', async () => {
    render(<InventoryCountPage />)
    expect(await screen.findByText('IC-20260801-91000000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批处理功能' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    expect(await screen.findByRole('table', { name: '盘点商品明细' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '审批通过' }))
    const confirmation = await screen.findByRole('alertdialog', { name: '审批通过并记账' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认审批' }))
    await waitFor(() => expect(inventoryCountApi.transition).toHaveBeenCalledWith(countId, 'approve', 1, '94000000-0000-4000-8000-000000000001'))
    expect(await screen.findByText('审批员')).toBeTruthy()
  })

  it('opens the single filtered source detail from a document-center deep link', async () => {
    routerState.search = `?searchField=BATCH&keyword=${summary.countNo}&showDetails=true`

    render(<InventoryCountPage />)

    expect(await screen.findByRole('dialog', {
      name: `盘点批次 ${summary.countNo}`,
    })).toBeTruthy()
    expect(inventoryCountApi.list).toHaveBeenCalledWith(
      expect.objectContaining({
        searchField: 'BATCH',
        keyword: summary.countNo,
      }),
    )
    expect(inventoryCountApi.get).toHaveBeenCalledWith(countId)
  })

  it('loads and navigates a URL-backed page of count batches', async () => {
    routerState.search = '?searchField=SKU&keyword=SKU-1&page=2&size=20'
    vi.mocked(inventoryCountApi.list).mockResolvedValue({
      items: [summary], page: 2, size: 20, totalElements: 67, totalPages: 4,
    })

    render(<InventoryCountPage />)

    expect(await screen.findByText('共 67 条 · 第 3 / 4 页')).toBeTruthy()
    expect(inventoryCountApi.list).toHaveBeenCalledWith(expect.objectContaining({
      searchField: 'SKU', keyword: 'SKU-1', page: 2, size: 20,
    }))

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(routerState.push).toHaveBeenLastCalledWith(
      '/warehouses/counts?searchField=SKU&keyword=SKU-1&page=1&size=20',
    )
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(routerState.push).toHaveBeenLastCalledWith(
      '/warehouses/counts?searchField=SKU&keyword=SKU-1&page=3&size=20',
    )
    fireEvent.change(screen.getByRole('combobox', { name: '每页条数' }), {
      target: { value: '100' },
    })
    expect(routerState.push).toHaveBeenLastCalledWith(
      '/warehouses/counts?searchField=SKU&keyword=SKU-1&size=100',
    )
  })

  it('creates a submitted count from warehouse balances', async () => {
    render(<InventoryCountPage />)
    await screen.findByText('IC-20260801-91000000')
    fireEvent.click(screen.getByRole('button', { name: '新增盘点' }))
    fireEvent.change(await screen.findByLabelText('* 仓库'), { target: { value: warehouseId } })
    fireEvent.change(await screen.findByLabelText('SKU-1 盘点库存'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并提交盘点' }))
    await waitFor(() => expect(inventoryCountApi.create).toHaveBeenCalledWith(expect.objectContaining({ warehouseId, submit: true, lines: [{ balanceId, countedOnHand: 12 }] })))
  })

  it('loads every stable active warehouse page for count creation', async () => {
    const secondWarehouse = {
      ...warehouse,
      id: '92000000-0000-4000-8000-000000000002',
      businessCode: 'WH-2',
      name: '分仓',
    }
    vi.mocked(warehouseCenterApi.listWarehouses).mockImplementation(async (request) => request.page === 0
      ? { items: [warehouse], page: 0, size: 200, totalElements: 2, totalPages: 2 }
      : { items: [secondWarehouse], page: 1, size: 200, totalElements: 2, totalPages: 2 })

    render(<InventoryCountPage />)
    await screen.findByText('IC-20260801-91000000')
    fireEvent.click(screen.getByRole('button', { name: '新增盘点' }))

    const selector = await screen.findByLabelText<HTMLSelectElement>('* 仓库')
    expect(within(selector).getByRole('option', { name: '分仓 · WH-2' })).toBeTruthy()
    expect(warehouseCenterApi.listWarehouses).toHaveBeenCalledWith({ status: 'ACTIVE', page: 1, size: 200 })
  })

  it('keeps entered quantities while paging warehouse balances and submits all visited rows', async () => {
    const secondBalance = {
      ...balance,
      id: '93000000-0000-4000-8000-000000000002',
      skuId: '96000000-0000-4000-8000-000000000002',
      skuBusinessCode: 'SKU-2',
      skuName: '商品二',
      onHand: 20,
      available: 19,
    }
    vi.mocked(inventoryApi.listBalances).mockImplementation(async (request) => request.page === 0
      ? { items: [balance], page: 0, size: 200, totalElements: 201, totalPages: 2 }
      : { items: [secondBalance], page: 1, size: 200, totalElements: 201, totalPages: 2 })

    render(<InventoryCountPage />)
    await screen.findByText('IC-20260801-91000000')
    fireEvent.click(screen.getByRole('button', { name: '新增盘点' }))
    fireEvent.change(await screen.findByLabelText('* 仓库'), { target: { value: warehouseId } })
    fireEvent.change(await screen.findByLabelText('SKU-1 盘点库存'), { target: { value: '12' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '盘点商品分页' })).getByRole('button', { name: '下一页' }))
    fireEvent.change(await screen.findByLabelText('SKU-2 盘点库存'), { target: { value: '18' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '盘点商品分页' })).getByRole('button', { name: '上一页' }))
    expect((await screen.findByLabelText('SKU-1 盘点库存') as HTMLInputElement).value).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: '保存并提交盘点' }))

    await waitFor(() => expect(inventoryCountApi.create).toHaveBeenCalledWith(expect.objectContaining({
      warehouseId,
      submit: true,
      lines: [
        { balanceId, countedOnHand: 12 },
        { balanceId: secondBalance.id, countedOnHand: 18 },
      ],
    })))
    expect(inventoryApi.listBalances).toHaveBeenNthCalledWith(1, { warehouseId, page: 0, size: 200 })
    expect(inventoryApi.listBalances).toHaveBeenNthCalledWith(2, { warehouseId, page: 1, size: 200 })
  })

  it('rejects more than 200 selected count rows before calling the create contract', () => {
    const balances = Array.from({ length: 201 }, (_, index) => ({
      ...balance,
      id: `93000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      skuId: `96000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      skuBusinessCode: `SKU-${index + 1}`,
      skuName: `商品${index + 1}`,
    }))
    const quantities = Object.fromEntries(balances.map((candidate) => [candidate.id, '1']))

    expect(() => buildInventoryCountLines(balances, quantities)).toThrow('单个盘点批次最多包含 200 个库存 SKU。')
  })

  it('downloads the current filtered count result and announces success', async () => {
    routerState.search = '?searchField=SKU&keyword=SKU-1&status=APPROVAL&start=2026-07-01&end=2026-08-01&minimum=-2&maximum=5'
    const createObjectURL = vi.fn(() => 'blob:inventory-counts')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<InventoryCountPage />)
    await screen.findByText('IC-20260801-91000000')

    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(await screen.findByText('已导出 1 条库存盘点。')).toBeTruthy()
    expect(inventoryCountApi.exportCsv).toHaveBeenCalledWith({ searchField: 'SKU', keyword: 'SKU-1', status: 'APPROVAL', from: '2026-07-01', to: '2026-08-01', differenceMin: -2, differenceMax: 5 })
    expect(createObjectURL).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:inventory-counts')
  })

  it('announces a recovery message when the export is too large', async () => {
    vi.mocked(inventoryCountApi.exportCsv).mockRejectedValue(new ApiError('hidden', { status: 409 }))
    render(<InventoryCountPage />)
    await screen.findByText('IC-20260801-91000000')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))
    expect((await screen.findByRole('alert')).textContent).toBe('导出结果超过 10,000 条，请缩小筛选范围后重试。')
  })
})
