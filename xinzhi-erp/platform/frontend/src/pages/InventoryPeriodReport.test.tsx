import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inventoryPeriodReportApi } from '../modules/inventoryPeriodReportApi'
import { InventoryPeriodReport } from './InventoryPeriodReport'

vi.mock('../modules/inventoryPeriodReportApi', async () => {
  const actual = await vi.importActual<typeof import('../modules/inventoryPeriodReportApi')>('../modules/inventoryPeriodReportApi')
  return { ...actual, inventoryPeriodReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } }
})

const summarize = vi.mocked(inventoryPeriodReportApi.summarize)
const exportCsv = vi.mocked(inventoryPeriodReportApi.exportCsv)
const page = {
  items: [{
    skuId: 'a1000000-0000-4000-8000-000000000001',
    skuBusinessCode: 'SKU-1',
    skuName: '测试商品',
    warehouseId: 'a1000000-0000-4000-8000-000000000002',
    warehouseBusinessCode: 'WH-1',
    warehouseName: '主仓',
    openingQuantity: 10,
    increasedQuantity: 5,
    decreasedQuantity: 3,
    closingQuantity: 12,
  }],
  totalOpeningQuantity: 10,
  totalIncreasedQuantity: 5,
  totalDecreasedQuantity: 3,
  totalClosingQuantity: 12,
  page: 0,
  size: 50,
  totalElements: 51,
  totalPages: 2,
}

beforeEach(() => {
  summarize.mockReset().mockResolvedValue(page)
  exportCsv.mockReset().mockResolvedValue({
    filename: 'inventory-period-report.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 51,
    content: '\uFEFF库存SKU,商品名称,仓库编码,仓库名称,期初数量,期间增加,期间减少,期末数量\r\n',
  })
})
afterEach(cleanup)

describe('inventory period report', () => {
  it('loads exact quantities, submits filters and pages without duplicating UI', async () => {
    const onFilter = vi.fn()
    render(<InventoryPeriodReport keyword="SKU-1" start="2026-07-01" end="2026-07-31" onFilter={onFilter} onReset={vi.fn()} />)

    expect(await screen.findByText('测试商品')).toBeTruthy()
    expect(screen.getByLabelText('库存期间汇总').textContent)
      .toContain('期末数量12')
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      keyword: 'SKU-1',
      page: 0,
      size: 50,
    }))

    fireEvent.change(screen.getByLabelText('SKU / 商品 / 仓库'), {
      target: { value: ' SKU-2 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(onFilter).toHaveBeenCalledWith(
      'SKU-2',
      '2026-07-01',
      '2026-07-31',
    )

    summarize.mockResolvedValue({ ...page, page: 1 })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(summarize).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    ))
  })

  it('downloads the current filters and announces success', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:inventory-period'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<InventoryPeriodReport keyword="SKU-1" start="2026-07-01" end="2026-07-31" onFilter={vi.fn()} onReset={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      keyword: 'SKU-1',
    }))
    expect(await screen.findByText('已导出 51 条库存期间数据。')).toBeTruthy()
  })
})
