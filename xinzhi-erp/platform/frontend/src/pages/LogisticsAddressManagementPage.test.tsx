import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsAddressApi } from '../modules/logisticsAddressApi'
import {
  LogisticsAddressManagementPage,
  parseLogisticsAddressQuery,
  toLogisticsAddressUrl,
} from './LogisticsAddressManagementPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn(), canWrite: true }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => runtime.canWrite }),
}))
vi.mock('../modules/logisticsAddressApi', () => ({
  logisticsAddressApi: {
    list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(),
  },
}))

const item = {
  id: '78000000-0000-4000-8000-000000000001', addressType: 'SHIPPING' as const,
  name: '上海发货仓', contactName: '运营联系人', countryCode: 'CN',
  province: '上海市', city: '上海市', district: '浦东新区',
  addressLine1: '世纪大道 1 号', status: 'ACTIVE' as const, version: 0,
  updatedAt: '2026-08-07T00:00:00Z',
}
const detail = {
  ...item, contactEmail: 'ops@example.com', mobile: '+86 13800000000',
  postalCode: '200120', companyName: '新知科技',
  createdAt: '2026-08-07T00:00:00Z',
}

beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset(); runtime.canWrite = true
  vi.mocked(logisticsAddressApi.list).mockReset().mockResolvedValue({
    items: [item], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  vi.mocked(logisticsAddressApi.detail).mockReset().mockResolvedValue(detail)
  vi.mocked(logisticsAddressApi.create).mockReset().mockResolvedValue(detail)
  vi.mocked(logisticsAddressApi.update).mockReset().mockResolvedValue(detail)
  vi.mocked(logisticsAddressApi.archive).mockReset().mockResolvedValue({
    ...detail, status: 'ARCHIVED', version: 1,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('logistics address management', () => {
  it('bounds URL state and rejects unknown values', () => {
    expect(parseLogisticsAddressQuery(`?type=UNKNOWN&status=FAILED&page=-2&keyword=${'A'.repeat(140)}`))
      .toEqual({ type: 'SHIPPING', status: 'ACTIVE', keyword: 'A'.repeat(120), page: 0 })
    expect(toLogisticsAddressUrl({
      type: 'RECEIVING_TRANSIT', status: 'ARCHIVED', keyword: ' 上海 ', page: 2,
    })).toBe('/logistics/addresses?type=RECEIVING_TRANSIT&status=ARCHIVED&keyword=%E4%B8%8A%E6%B5%B7&page=2')
  })

  it('loads summary-only data and writes filters to the URL', async () => {
    render(<LogisticsAddressManagementPage />)
    expect(await screen.findByText('上海发货仓')).toBeTruthy()
    expect(screen.queryByText('ops@example.com')).toBeNull()
    await waitFor(() => expect(logisticsAddressApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHIPPING', status: 'ACTIVE', page: 0, size: 25 }),
    ))
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'ALL' } })
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: ' 上海 ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.push).toHaveBeenCalledWith('/logistics/addresses?status=ALL&keyword=%E4%B8%8A%E6%B5%B7')
  })

  it('creates a normalized address with labelled grouped fields', async () => {
    render(<LogisticsAddressManagementPage />)
    await screen.findByText('上海发货仓')
    fireEvent.click(screen.getByRole('button', { name: '新增发货地址' }))
    const form = screen.getByRole('form', { name: '新增物流地址' })
    fireEvent.change(within(form).getByLabelText('名称'), { target: { value: ' 深圳仓 ' } })
    fireEvent.change(within(form).getByLabelText('联系人'), { target: { value: ' 仓库主管 ' } })
    fireEvent.change(within(form).getByLabelText('邮箱'), { target: { value: ' ops@example.com ' } })
    fireEvent.change(within(form).getByLabelText('国家代码'), { target: { value: 'cn' } })
    fireEvent.change(within(form).getByLabelText('详细地址'), { target: { value: ' 科技园 1 号 ' } })
    fireEvent.click(within(form).getByRole('button', { name: '保存地址' }))
    await waitFor(() => expect(logisticsAddressApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '深圳仓', contactName: '仓库主管', countryCode: 'CN', addressLine1: '科技园 1 号' }),
    ))
    expect(await screen.findByText('地址“深圳仓”已创建。')).toBeTruthy()
  })

  it('loads full detail only for editing and confirms archive', async () => {
    render(<LogisticsAddressManagementPage />)
    await screen.findByText('上海发货仓')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByDisplayValue('ops@example.com')).toBeTruthy()
    expect(logisticsAddressApi.detail).toHaveBeenCalledWith(item.id)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(logisticsAddressApi.archive).toHaveBeenCalledWith(item.id, 0))
    expect(window.confirm).toHaveBeenCalled()
  })
})
