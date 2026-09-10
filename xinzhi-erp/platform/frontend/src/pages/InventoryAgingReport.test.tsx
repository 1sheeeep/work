import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inventoryAgingReportApi } from '../modules/inventoryAgingReportApi'
import { warehouseCenterApi } from '../modules/warehouseCenterApi'
import { InventoryAgingReport } from './InventoryAgingReport'

vi.mock('../modules/inventoryAgingReportApi', async () => {
  const actual = await vi.importActual<typeof import('../modules/inventoryAgingReportApi')>('../modules/inventoryAgingReportApi')
  return { ...actual, inventoryAgingReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } }
})
vi.mock('../modules/warehouseCenterApi', async () => {
  const actual = await vi.importActual<typeof import('../modules/warehouseCenterApi')>('../modules/warehouseCenterApi')
  return { ...actual, warehouseCenterApi: { listWarehouses: vi.fn() } }
})

const warehouseId = 'a3000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValue({
    items: [{
      id: warehouseId,
      businessCode: 'WH-1',
      name: '测试仓库',
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  })
  vi.mocked(inventoryAgingReportApi.summarize).mockResolvedValue({
    items: [{
      skuId: 'a3000000-0000-4000-8000-000000000001',
      skuBusinessCode: 'SKU-AGING-1',
      skuName: '测试商品',
      warehouseId,
      warehouseBusinessCode: 'WH-1',
      warehouseName: '测试仓库',
      oldestInventoryDate: '2026-03-01',
      maximumAgeDays: 162,
      totalQuantity: 40,
      age0To30Quantity: 0,
      age31To60Quantity: 0,
      age61To90Quantity: 20,
      age91To365Quantity: 20,
      ageOver365Quantity: 0,
    }],
    totalQuantity: 40,
    age0To30Quantity: 0,
    age31To60Quantity: 0,
    age61To90Quantity: 20,
    age91To365Quantity: 20,
    ageOver365Quantity: 0,
    page: 0,
    size: 50,
    totalElements: 1,
    totalPages: 1,
  })
})

afterEach(cleanup)

describe('InventoryAgingReport', () => {
  it('renders real FIFO buckets and submits warehouse filters', async () => {
    const onFilter = vi.fn()
    render(<InventoryAgingReport
      keyword=""
      cutoff="2026-08-10"
      onFilter={onFilter}
      onReset={vi.fn()}
    />)

    expect(await screen.findByText('SKU-AGING-1')).toBeTruthy()
    expect(screen.getByText('需要关注')).toBeTruthy()
    expect(within(screen.getByLabelText('库存库龄汇总')).getByText('40')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('option', { name: 'WH-1 · 测试仓库' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('库龄搜索内容'), {
      target: { value: ' SKU-AGING-1 ' },
    })
    fireEvent.change(screen.getByLabelText('库龄仓库'), {
      target: { value: warehouseId },
    })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(onFilter).toHaveBeenCalledWith(
      'SKU-AGING-1',
      '2026-08-10',
      warehouseId,
    )
  })

  it('shows a real empty state and keeps export unavailable', async () => {
    vi.mocked(inventoryAgingReportApi.summarize).mockResolvedValue({
      items: [],
      totalQuantity: 0,
      age0To30Quantity: 0,
      age31To60Quantity: 0,
      age61To90Quantity: 0,
      age91To365Quantity: 0,
      ageOver365Quantity: 0,
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
    })
    render(<InventoryAgingReport
      keyword="missing"
      cutoff="2026-08-10"
      onFilter={vi.fn()}
      onReset={vi.fn()}
    />)
    expect(await screen.findByText('暂无符合条件的在库库存')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出筛选结果' })).toHaveProperty('disabled', true)
  })
})
