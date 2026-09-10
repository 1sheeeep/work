import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackingNumberApi } from '../modules/trackingNumberApi'
import {
  LogisticsTrackingNumberPage,
  parseTrackingNumberQuery,
  toTrackingNumberUrl,
} from './LogisticsTrackingNumberPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn(), canWrite: true }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => runtime.canWrite }),
}))
vi.mock('../modules/trackingNumberApi', () => ({
  trackingNumberApi: { list: vi.fn(), importNumbers: vi.fn(), archive: vi.fn() },
}))

beforeEach(() => {
  runtime.search = ''
  runtime.push.mockReset()
  runtime.canWrite = true
  vi.mocked(trackingNumberApi.list).mockReset().mockResolvedValue({
    items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
  })
  vi.mocked(trackingNumberApi.importNumbers).mockReset().mockResolvedValue({
    batchId: '77000000-0000-4000-8000-000000000001', importedCount: 2,
  })
  vi.mocked(trackingNumberApi.archive).mockReset()
})
afterEach(cleanup)

describe('logistics tracking number management', () => {
  it('bounds query values and rejects unknown enums', () => {
    expect(parseTrackingNumberQuery(
      `?type=UNKNOWN&searchField=OTHER&status=FAILED&page=-2&keyword=${'A'.repeat(140)}`,
    )).toEqual({
      type: 'DOMESTIC_EXPRESS', searchField: 'TRACKING_NO',
      keyword: 'A'.repeat(120), status: 'ALL', channel: '', page: 0,
    })
    expect(toTrackingNumberUrl({
      type: 'CUSTOM_LOGISTICS', searchField: 'ORDER_NO', keyword: ' O-100 ',
      status: 'UNUSED', page: 2,
    })).toBe('/logistics/tracking-numbers?type=CUSTOM_LOGISTICS&searchField=ORDER_NO&keyword=O-100&status=UNUSED&page=2')
  })

  it('loads the real pool and writes filters to the URL', async () => {
    render(<LogisticsTrackingNumberPage />)
    expect(await screen.findByRole('heading', { name: '运单号管理' })).toBeTruthy()
    await waitFor(() => expect(trackingNumberApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DOMESTIC_EXPRESS', page: 0, size: 25 }),
    ))
    fireEvent.change(screen.getByLabelText('搜索字段'), { target: { value: 'ORDER_NO' } })
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: ' O-1 ' } })
    fireEvent.change(screen.getByLabelText('使用状态'), { target: { value: 'UNUSED' } })
    fireEvent.change(screen.getByLabelText('物流渠道'), { target: { value: ' 渠道 A ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.push).toHaveBeenCalledWith('/logistics/tracking-numbers?searchField=ORDER_NO&keyword=O-1&status=UNUSED&channel=%E6%B8%A0%E9%81%93+A')
  })

  it('imports one number per line and gives accessible success feedback', async () => {
    render(<LogisticsTrackingNumberPage />)
    await screen.findByText('没有符合条件的运单号')
    fireEvent.click(screen.getByRole('button', { name: '批量导入运单号' }))
    const form = screen.getByRole('form', { name: '批量导入运单号' })
    fireEvent.change(within(form).getByLabelText('物流渠道'), { target: { value: 'SF' } })
    fireEvent.change(within(form).getByLabelText(/运单号（每行一个/), { target: { value: 'TN-1\nTN-2' } })
    fireEvent.click(within(form).getByRole('button', { name: '确认导入' }))
    await waitFor(() => expect(trackingNumberApi.importNumbers).toHaveBeenCalledWith({
      type: 'DOMESTIC_EXPRESS', channel: 'SF', trackingReferences: ['TN-1', 'TN-2'],
    }))
    expect((await screen.findByText('已导入 2 个运单号。')).textContent)
      .toContain('已导入 2 个运单号')
  })
})
