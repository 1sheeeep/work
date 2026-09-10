import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { logisticsTrackingApi } from '../modules/logisticsTrackingApi'
import {
  LogisticsTrackingPage,
  parseLogisticsTrackingQuery,
  toLogisticsTrackingUrl,
} from './LogisticsTrackingPage'

const routerState = vi.hoisted(() => ({ search: '', push: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'orders.read' }),
}))
vi.mock('../modules/logisticsTrackingApi', () => ({
  logisticsTrackingApi: { list: vi.fn(), exportCsv: vi.fn() },
}))

const item = {
  orderId: 'a1000000-0000-4000-8000-000000000001',
  platformCode: 'SHOPIFY',
  platformName: 'Shopify',
  shopName: '示例店铺',
  orderNo: 'ORDER-100',
  countryCode: 'US',
  warehouseSummary: 'WH-1 · 主仓',
  logisticsChannel: 'UPS',
  trackingReference: 'TN-100',
  trackingStatus: 'IN_TRANSIT',
  customCategory: '重点订单',
  shippedAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-02T08:00:00Z',
}

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  vi.mocked(logisticsTrackingApi.list).mockReset()
  vi.mocked(logisticsTrackingApi.list).mockResolvedValue({
    items: [item], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  vi.mocked(logisticsTrackingApi.exportCsv).mockReset().mockResolvedValue({
    filename: 'logistics-tracking.csv', mediaType: 'text/csv;charset=utf-8',
    rowCount: 1, content: '\uFEFF平台编码,平台名称\r\nSHOPIFY,Shopify\r\n',
  })
})

afterEach(cleanup)

describe('logistics tracking page', () => {
  it('bounds shareable filters and rejects malformed values', () => {
    expect(parseLogisticsTrackingQuery(
      `?shop=${'A'.repeat(120)}&country=usa&status=UNKNOWN&shippedFrom=2026-99-99&page=-1&size=999`,
    )).toEqual({
      shop: 'A'.repeat(100), carrier: '', country: '', warehouse: '', category: '',
      searchField: 'ORDER_NO', keyword: '', status: 'ALL', shippedFrom: '',
      shippedTo: '', page: 0, size: 25,
    })
    expect(toLogisticsTrackingUrl({
      shop: ' Shopify 店铺 ', country: 'us', searchField: 'TRACKING_NO',
      status: 'IN_TRANSIT', shippedFrom: '2026-08-01', page: 2, size: 50,
    })).toBe(
      '/logistics/tracking?shop=Shopify+%E5%BA%97%E9%93%BA&country=US&searchField=TRACKING_NO&status=IN_TRANSIT&shippedFrom=2026-08-01&page=2&size=50',
    )
  })

  it('loads recorded tracking data and opens the authoritative order', async () => {
    render(<LogisticsTrackingPage />)

    expect(await screen.findByText('ORDER-100')).toBeTruthy()
    expect(screen.getByText('TN-100')).toBeTruthy()
    expect(logisticsTrackingApi.list).toHaveBeenCalledWith(
      expect.objectContaining({
        searchField: 'ORDER_NO', page: 0, size: 25,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '查看订单' }))
    expect(routerState.push).toHaveBeenCalledWith(
      `/orders/${item.orderId}?page=0&size=25`,
    )
  })

  it('writes filters and status tabs to the URL', async () => {
    render(<LogisticsTrackingPage />)
    await screen.findByText('ORDER-100')

    fireEvent.change(screen.getByLabelText('店铺'), {
      target: { value: ' 店铺 A ' },
    })
    fireEvent.change(screen.getByLabelText('搜索字段'), {
      target: { value: 'TRACKING_NO' },
    })
    fireEvent.change(screen.getByLabelText('搜索内容'), {
      target: { value: ' TN-1 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(routerState.push).toHaveBeenCalledWith(
      '/logistics/tracking?shop=%E5%BA%97%E9%93%BA+A&searchField=TRACKING_NO&keyword=TN-1',
    )

    routerState.push.mockReset()
    fireEvent.click(screen.getByRole('tab', { name: '可能异常' }))
    expect(routerState.push).toHaveBeenCalledWith(
      '/logistics/tracking?status=EXCEPTION',
    )
  })

  it('announces list failures and retries without stale rows', async () => {
    vi.mocked(logisticsTrackingApi.list)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
      })

    render(<LogisticsTrackingPage />)
    expect((await screen.findByRole('alert')).textContent).toContain(
      '暂时无法读取物流跟踪记录',
    )
    expect(screen.queryByText('ORDER-100')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(logisticsTrackingApi.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('没有符合条件的物流跟踪记录')).toBeTruthy()
  })

  it('exports the complete filtered result and announces success', async () => {
    routerState.search = '?shop=Demo&carrier=UPS&country=US&warehouse=Main&category=Priority&searchField=TRACKING_NO&keyword=TN-1&status=IN_TRANSIT&shippedFrom=2026-08-01&shippedTo=2026-08-02'
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tracking')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<LogisticsTrackingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect(logisticsTrackingApi.exportCsv).toHaveBeenCalledWith({
      shop: 'Demo', carrier: 'UPS', country: 'US', warehouse: 'Main',
      category: 'Priority', searchField: 'TRACKING_NO', keyword: 'TN-1',
      status: 'IN_TRANSIT', shippedFrom: '2026-07-31T16:00:00.000Z',
      shippedTo: '2026-08-02T15:59:59.999Z',
    })
    expect(await screen.findByText('已导出 1 条物流跟踪记录。')).toBeTruthy()
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:tracking')
  })

  it('explains how to recover when a tracking export is too large', async () => {
    vi.mocked(logisticsTrackingApi.exportCsv).mockRejectedValue(new ApiError('too many', { status: 409 }))
    render(<LogisticsTrackingPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请缩小筛选范围后重试')
    expect(screen.getByRole('button', { name: '导出筛选结果' })).not.toHaveProperty('disabled', true)
  })
})
