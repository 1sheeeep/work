import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsStatisticsApi } from '../modules/logisticsStatisticsApi'
import {
  LogisticsStatisticsPage,
  parseLogisticsStatisticsQuery,
  toLogisticsStatisticsUrl,
} from './LogisticsStatisticsPage'

const routerState = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }),
}))
vi.mock('../modules/logisticsStatisticsApi', () => ({
  logisticsStatisticsApi: { summarize: vi.fn(), exportCsv: vi.fn() },
}))

const summarize = vi.mocked(logisticsStatisticsApi.summarize)
const exportCsv = vi.mocked(logisticsStatisticsApi.exportCsv)

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  summarize.mockReset()
  summarize.mockResolvedValue({
    items: [{
      groupValue: 'US',
      recordCount: 3,
      statuses: [
        { status: 'DELIVERED', recordCount: 2 },
        { recordCount: 1 },
      ],
    }],
    totalStatuses: [
      { status: 'DELIVERED', recordCount: 2 },
      { recordCount: 1 },
    ],
    dimension: 'COUNTRY',
    totalRecords: 3,
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  })
  exportCsv.mockReset().mockResolvedValue({
    filename: 'logistics-statistics.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 2,
    content: '\uFEFF统计维度,分组值,跟踪状态,状态记录数,分组记录数\r\n',
  })
})
afterEach(cleanup)

describe('logistics statistics page', () => {
  it('bounds query values and rejects unknown dimensions and invalid dates', () => {
    expect(parseLogisticsStatisticsQuery(`?dimension=OTHER&timeMode=WEEK&value=${'A'.repeat(120)}&from=2026-99-99&page=-1&size=500`)).toEqual({
      dimension: 'COUNTRY', value: 'A'.repeat(100), timeMode: 'RANGE',
      from: '', to: '', page: 0, size: 25,
    })
    expect(toLogisticsStatisticsUrl({
      dimension: 'CHANNEL', value: ' 渠道 A ', timeMode: 'TODAY',
      from: '2026-08-01', page: 2, size: 50,
    })).toBe('/logistics/statistics?dimension=CHANNEL&value=%E6%B8%A0%E9%81%93+A&timeMode=TODAY&page=2&size=50')
  })

  it('loads real grouped counts and links each group to tracking details', async () => {
    routerState.search = '?from=2026-08-01&to=2026-08-02'
    render(<LogisticsStatisticsPage />)

    expect(await screen.findByRole('heading', { name: '物流统计' })).toBeTruthy()
    expect(await screen.findByText('签收成功 2')).toBeTruthy()
    expect(screen.getByText('未记录状态 1')).toBeTruthy()
    expect(screen.getAllByText('3')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '查看相关明细' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/tracking?country=US&shippedFrom=2026-08-01&shippedTo=2026-08-02')
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      dimension: 'COUNTRY', page: 0, size: 25,
      shippedFrom: '2026-07-31T16:00:00.000Z',
      shippedToExclusive: '2026-08-02T16:00:00.000Z',
    }))
  })

  it('writes filters and dimension changes to the URL', async () => {
    render(<LogisticsStatisticsPage />)
    await screen.findByText('签收成功 2')

    fireEvent.change(screen.getByLabelText('国家 / 地区'), { target: { value: ' US ' } })
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: '统计' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/statistics?value=US&from=2026-08-01')

    fireEvent.click(screen.getByRole('tab', { name: '按渠道统计' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/statistics?dimension=CHANNEL')
  })

  it('shows load errors and retries without losing query state', async () => {
    summarize.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [], totalStatuses: [], dimension: 'COUNTRY', totalRecords: 0,
        page: 0, size: 25, totalElements: 0, totalPages: 0,
      })
    render(<LogisticsStatisticsPage />)

    expect((await screen.findByRole('alert')).textContent)
      .toContain('暂时无法读取物流统计')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('没有符合条件的物流统计')).toBeTruthy()
  })

  it('downloads the current statistics filter and announces success', async () => {
    routerState.search = '?dimension=CHANNEL&value=UPS&from=2026-08-01&to=2026-08-02'
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:logistics-statistics'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<LogisticsStatisticsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      dimension: 'CHANNEL',
      value: 'UPS',
      shippedFrom: '2026-07-31T16:00:00.000Z',
      shippedToExclusive: '2026-08-02T16:00:00.000Z',
    }))
    expect(await screen.findByText('已导出 2 条物流状态统计。')).toBeTruthy()
  })
})
