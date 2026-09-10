import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { logisticsStatisticsApi } from '../modules/logisticsStatisticsApi'
import {
  LogisticsTrackingWorkbenchPage,
  parseTrackingWorkbenchQuery,
  toTrackingWorkbenchUrl,
} from './LogisticsTrackingWorkbenchPage'

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
  exportCsv.mockReset().mockResolvedValue({
    filename: 'logistics-statistics.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 2,
    content: '\uFEFF统计维度,分组值,跟踪状态,状态记录数,分组记录数\r\n渠道,UPS Ground,DELIVERED,2,3\r\n',
  })
  summarize.mockResolvedValue({
    items: [{
      groupValue: 'UPS Ground',
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
    dimension: 'CHANNEL',
    totalRecords: 3,
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  })
})
afterEach(cleanup)

describe('logistics tracking workbench', () => {
  it('bounds shareable channel and paging filters', () => {
    expect(parseTrackingWorkbenchQuery(`?channel=${'A'.repeat(120)}&page=-1&size=500`)).toEqual({
      channel: 'A'.repeat(100), page: 0, size: 25,
    })
    expect(toTrackingWorkbenchUrl({ channel: ' 渠道 A ', page: 2, size: 50 }))
      .toBe('/logistics/tracking/workbench?channel=%E6%B8%A0%E9%81%93+A&page=2&size=50')
  })

  it('loads stored status counts without inferring delivery rates', async () => {
    render(<LogisticsTrackingWorkbenchPage />)

    expect(await screen.findByRole('heading', { name: '物流跟踪工作台' })).toBeTruthy()
    expect(await screen.findByText('签收成功')).toBeTruthy()
    expect(screen.getByText('未记录状态')).toBeTruthy()
    expect(screen.queryByText('妥投率')).toBeNull()
    expect(screen.queryByRole('button', { name: '跟踪设置' })).toBeNull()
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      dimension: 'CHANNEL', page: 0, size: 25,
    }))

    fireEvent.click(screen.getByRole('button', { name: '查看相关明细' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/tracking?carrier=UPS+Ground')
  })

  it('writes filters and page size to the URL', async () => {
    render(<LogisticsTrackingWorkbenchPage />)
    await screen.findByText('UPS Ground')

    fireEvent.change(screen.getByLabelText('物流渠道'), {
      target: { value: ' 渠道 A ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/tracking/workbench?channel=%E6%B8%A0%E9%81%93+A')

    fireEvent.change(screen.getByLabelText('工作台每页渠道数'), {
      target: { value: '50' },
    })
    expect(routerState.push).toHaveBeenCalledWith('/logistics/tracking/workbench?size=50')
    fireEvent.click(screen.getByRole('tab', { name: '物流跟踪' }))
    expect(routerState.push).toHaveBeenCalledWith('/logistics/tracking')
  })

  it('shows load errors and retries without inventing fallback data', async () => {
    summarize.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [], totalStatuses: [], dimension: 'CHANNEL', totalRecords: 0,
        page: 0, size: 25, totalElements: 0, totalPages: 0,
      })
    render(<LogisticsTrackingWorkbenchPage />)

    expect((await screen.findByRole('alert')).textContent)
      .toContain('暂时无法读取物流跟踪工作台')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('没有符合条件的物流跟踪记录')).toBeTruthy()
  })

  it('exports the current channel filter and announces success', async () => {
    routerState.search = '?channel=UPS'
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:tracking-workbench'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<LogisticsTrackingWorkbenchPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      dimension: 'CHANNEL',
      value: 'UPS',
    }))
    expect((await screen.findByRole('status')).textContent)
      .toContain('已导出 2 条物流渠道状态统计。')
  })

  it('announces the bounded export recovery message', async () => {
    exportCsv.mockRejectedValueOnce(new ApiError('too many rows', { status: 409 }))
    render(<LogisticsTrackingWorkbenchPage />)

    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))

    expect((await screen.findByRole('alert')).textContent)
      .toContain('导出结果超过 10,000 条，请缩小物流渠道范围后重试。')
  })
})
