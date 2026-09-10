import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsForecastApi } from '../modules/logisticsForecastApi'
import { LogisticsForecastPage, parseLogisticsForecastQuery, toLogisticsForecastUrl } from './LogisticsForecastPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.forecast.write' }),
}))
vi.mock('../modules/logisticsForecastApi', () => ({
  logisticsForecastApi: { list: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), markPrinted: vi.fn() },
}))
const batch = {
  id: '11111111-1111-4111-8111-111111111111', batchNo: 'FB-20260810-000000-ABC123',
  batchType: 'UAT 日常预报', forwarder: 'UAT 货代',
  orderReferences: ['UAT-ORDER-001', 'UAT-ORDER-002'], orderCount: 2,
  totalWeightKg: 2.5, status: 'PENDING' as const, printed: false,
  resultMessage: undefined, createdByDisplayName: 'UAT ERP Tester', version: 0,
  createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z',
}
beforeEach(() => {
  runtime.search = '?status=PENDING'; runtime.push.mockReset()
  vi.mocked(logisticsForecastApi.list).mockReset().mockResolvedValue({ items: [batch], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  vi.mocked(logisticsForecastApi.create).mockReset().mockResolvedValue(batch)
  vi.mocked(logisticsForecastApi.updateStatus).mockReset().mockResolvedValue({ ...batch, status: 'SUCCEEDED', version: 1 })
  vi.mocked(logisticsForecastApi.markPrinted).mockReset().mockResolvedValue({ ...batch, status: 'SUCCEEDED', printed: true, version: 2 })
})
afterEach(cleanup)

describe('logistics forecast batches', () => {
  it('bounds and serializes filters', () => {
    expect(parseLogisticsForecastQuery('?status=BAD&printStatus=BAD')).toEqual({ status: 'HISTORY', batchType: '', creator: '', printStatus: 'ALL', keyword: '', forwarder: '' })
    expect(toLogisticsForecastUrl({ status: 'PENDING', keyword: ' UAT-1 ' })).toBe('/logistics/forecasts?status=PENDING&keyword=UAT-1')
  })
  it('loads, creates, and records a successful batch', async () => {
    render(<LogisticsForecastPage />)
    expect(await screen.findByText('FB-20260810-000000-ABC123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增预报批次' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增预报批次' }))
    fireEvent.change(dialog.getByLabelText('批次类型'), { target: { value: 'UAT 日常预报' } })
    fireEvent.change(dialog.getByLabelText('货代'), { target: { value: 'UAT 货代' } })
    fireEvent.change(dialog.getByLabelText('订单编号'), { target: { value: 'UAT-ORDER-001\nUAT-ORDER-002' } })
    fireEvent.change(dialog.getByLabelText('批次总重量（kg）'), { target: { value: '2.5' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(logisticsForecastApi.create).toHaveBeenCalledWith({
      batchType: 'UAT 日常预报', forwarder: 'UAT 货代',
      orderReferences: ['UAT-ORDER-001', 'UAT-ORDER-002'], totalWeightKg: 2.5,
    }))
    fireEvent.click(screen.getByRole('button', { name: '记录成功' }))
    await waitFor(() => expect(logisticsForecastApi.updateStatus)
      .toHaveBeenCalledWith(batch.id, 0, 'SUCCEEDED', undefined))
  })
})
