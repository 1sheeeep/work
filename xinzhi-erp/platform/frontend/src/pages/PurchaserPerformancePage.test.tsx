import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { purchaserStatisticsApi } from '../modules/purchaserStatisticsApi'
import {
  PurchaserPerformancePage,
  parsePurchaserPerformanceQuery,
  toPurchaserPerformanceUrl,
} from './PurchaserPerformancePage'

const routerState = vi.hoisted(() => ({ search: '', push: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({
    location: { searchStr: routerState.search },
  }),
}))

vi.mock('../modules/purchaserStatisticsApi', async () => {
  const actual = await vi.importActual<typeof import('../modules/purchaserStatisticsApi')>('../modules/purchaserStatisticsApi')
  return {
    ...actual,
    purchaserStatisticsApi: { summarize: vi.fn(), exportCsv: vi.fn() },
  }
})

const summarize = vi.mocked(purchaserStatisticsApi.summarize)
const exportCsv = vi.mocked(purchaserStatisticsApi.exportCsv)

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  summarize.mockReset()
  summarize.mockResolvedValue({
    items: [], granularity: 'DAY', totalOrders: 0,
    totalOrderedQuantity: 0, totalReceivedQuantity: 0,
    totalOutstandingQuantity: 0, page: 0, size: 25,
    totalElements: 0, totalPages: 0,
  })
  exportCsv.mockReset().mockResolvedValue({
    filename: 'purchaser-statistics.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 1,
    content: '\uFEFF统计期间（UTC）,统计粒度,采购员名称快照,采购单数,采购数量,已收数量,待收数量,待审核,待收货,部分收货,已收货\r\n',
  })
})

afterEach(cleanup)

describe('purchaser performance page', () => {
  it('bounds and serializes confirmed report filters', () => {
    expect(parsePurchaserPerformanceQuery(
      '?granularity=UNKNOWN&purchaser=%20Buyer%20&startDate=2026-02-30&page=-1&size=101',
    )).toEqual({
      granularity: 'DAY', purchaser: 'Buyer', startDate: '', endDate: '',
      page: 0, size: 25,
    })
    expect(toPurchaserPerformanceUrl({
      granularity: 'MONTH', purchaser: ' Buyer ',
      startDate: '2026-01-01', endDate: '2026-01-31', size: 50,
    })).toBe('/procurement/statistics/purchaser-performance?granularity=MONTH&purchaser=Buyer&startDate=2026-01-01&endDate=2026-01-31&size=50')
  })

  it('loads exact purchaser order and receipt counts', async () => {
    routerState.search = '?granularity=MONTH&purchaser=Buyer&startDate=2026-08-01&endDate=2026-08-31'
    summarize.mockResolvedValue({
      items: [{
        periodStart: '2026-08-01', purchaserDisplayName: 'Buyer A',
        orderCount: 4, orderedQuantity: 12, receivedQuantity: 7,
        outstandingQuantity: 5, newOrderCount: 1,
        approvedOrderCount: 1, partiallyReceivedOrderCount: 1,
        receivedOrderCount: 1,
      }],
      granularity: 'MONTH', totalOrders: 4, totalOrderedQuantity: 12,
      totalReceivedQuantity: 7, totalOutstandingQuantity: 5,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })

    render(<PurchaserPerformancePage />)
    await screen.findByRole('table', { name: '采购员业务统计结果' })

    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      granularity: 'MONTH', purchaser: 'Buyer',
      orderedFrom: '2026-08-01T00:00:00.000Z',
      orderedToExclusive: '2026-09-01T00:00:00.000Z',
      page: 0, size: 25,
    }))
    expect(screen.getByText('Buyer A')).toBeTruthy()
    expect(screen.getByText('12 / 7 / 5')).toBeTruthy()
    expect(screen.getByText('1 / 1 / 1 / 1')).toBeTruthy()
    expect(screen.getByText(/已驳回采购单不参与统计/)).toBeTruthy()
    expect(screen.queryByText('采购总金额')).toBeNull()
    expect(screen.queryByText('交付准时率')).toBeNull()
  })

  it('validates date order and recovers from failed loads', async () => {
    summarize.mockRejectedValueOnce(new Error('offline'))
    render(<PurchaserPerformancePage />)
    expect((await screen.findByRole('alert')).textContent)
      .toContain('暂时无法读取采购员业务统计')

    summarize.mockResolvedValueOnce({
      items: [], granularity: 'DAY', totalOrders: 0,
      totalOrderedQuantity: 0, totalReceivedQuantity: 0,
      totalOutstandingQuantity: 0, page: 0, size: 25,
      totalElements: 0, totalPages: 0,
    })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(2))

    fireEvent.change(screen.getByLabelText('起始日期'), {
      target: { value: '2026-08-02' },
    })
    fireEvent.change(screen.getByLabelText('截止日期'), {
      target: { value: '2026-08-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(screen.getByRole('alert').textContent)
      .toContain('起始日期不能晚于截止日期')
  })

  it('downloads the current filtered result and announces success', async () => {
    routerState.search = '?granularity=MONTH&purchaser=Buyer&startDate=2026-08-01&endDate=2026-08-31'
    summarize.mockResolvedValue({
      items: [{
        periodStart: '2026-08-01', purchaserDisplayName: 'Buyer A',
        orderCount: 4, orderedQuantity: 12, receivedQuantity: 7,
        outstandingQuantity: 5, newOrderCount: 1,
        approvedOrderCount: 1, partiallyReceivedOrderCount: 1,
        receivedOrderCount: 1,
      }],
      granularity: 'MONTH', totalOrders: 4, totalOrderedQuantity: 12,
      totalReceivedQuantity: 7, totalOutstandingQuantity: 5,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:purchaser-statistics'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<PurchaserPerformancePage />)
    fireEvent.click(await screen.findByRole('button', {
      name: '导出筛选结果',
    }))

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      granularity: 'MONTH',
      purchaser: 'Buyer',
      orderedFrom: '2026-08-01T00:00:00.000Z',
      orderedToExclusive: '2026-09-01T00:00:00.000Z',
    }))
    expect(await screen.findByText('已导出 1 条采购员业务统计。'))
      .toBeTruthy()
  })

  it('announces an oversized export and permits retry', async () => {
    summarize.mockResolvedValue({
      items: [{
        periodStart: '2026-08-01', purchaserDisplayName: 'Buyer A',
        orderCount: 1, orderedQuantity: 1, receivedQuantity: 0,
        outstandingQuantity: 1, newOrderCount: 1,
        approvedOrderCount: 0, partiallyReceivedOrderCount: 0,
        receivedOrderCount: 0,
      }],
      granularity: 'DAY', totalOrders: 1, totalOrderedQuantity: 1,
      totalReceivedQuantity: 0, totalOutstandingQuantity: 1,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    exportCsv.mockRejectedValueOnce(new ApiError('hidden', { status: 409 }))
    render(<PurchaserPerformancePage />)

    fireEvent.click(await screen.findByRole('button', {
      name: '导出筛选结果',
    }))

    expect((await screen.findByRole('alert')).textContent)
      .toContain('超过 10,000 个统计分组')
    expect(screen.getByRole('button', { name: '导出筛选结果' }))
      .toHaveProperty('disabled', false)
  })
})
