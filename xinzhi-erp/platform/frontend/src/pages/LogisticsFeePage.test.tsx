import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsFeeApi } from '../modules/logisticsFeeApi'
import { LogisticsFeePage, parseLogisticsFeeQuery, toLogisticsFeeUrl } from './LogisticsFeePage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.fee.write' }),
}))
vi.mock('../modules/logisticsFeeApi', () => ({
  logisticsFeeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), confirm: vi.fn(), archive: vi.fn() },
}))
const record = {
  id: '11111111-1111-4111-8111-111111111111', platformName: 'Shopify', shopName: 'UAT 店铺',
  channelName: 'UAT 标准渠道', orderReference: 'UAT-FEE-ORDER-001',
  trackingReference: 'UAT-TRACK-001', transactionReference: 'UAT-TX-001',
  estimatedFee: 24, actualFee: 25.4, feeVariance: 1.4, currency: 'USD',
  carrierWeightKg: 2.6, warehouseWeightKg: 2.5, weightVarianceKg: 0.1,
  shippedOn: '2026-08-10', confirmationStatus: 'UNCONFIRMED' as const,
  lifecycleStatus: 'ACTIVE' as const, note: 'UAT', confirmedByDisplayName: undefined,
  confirmedAt: undefined, createdByDisplayName: 'UAT ERP Tester', version: 0,
  createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z',
}
beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset()
  vi.mocked(logisticsFeeApi.list).mockReset().mockResolvedValue({ items: [record], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  vi.mocked(logisticsFeeApi.create).mockReset().mockResolvedValue(record)
  vi.mocked(logisticsFeeApi.update).mockReset().mockResolvedValue({ ...record, version: 1 })
  vi.mocked(logisticsFeeApi.confirm).mockReset().mockResolvedValue({ ...record, confirmationStatus: 'CONFIRMED', version: 1 })
  vi.mocked(logisticsFeeApi.archive).mockReset().mockResolvedValue({ ...record, lifecycleStatus: 'ARCHIVED', version: 1 })
})
afterEach(cleanup)

describe('logistics fee reconciliation', () => {
  it('bounds and serializes supported filters only', () => {
    expect(parseLogisticsFeeQuery('?status=BAD&hasActualFee=BAD&shippedFrom=2026-99-99')).toEqual({
      status: 'UNCONFIRMED', platform: '', shop: '', channel: '', searchField: 'ORDER_NO',
      keyword: '', hasActualFee: 'ALL', shippedFrom: '', shippedTo: '',
    })
    expect(toLogisticsFeeUrl({ status: 'CONFIRMED', platform: ' Shopify ', searchField: 'TRACKING_NO', keyword: ' UAT-1 ', hasActualFee: 'YES' }))
      .toBe('/logistics/fees?status=CONFIRMED&platform=Shopify&searchField=TRACKING_NO&keyword=UAT-1&hasActualFee=YES')
  })

  it('loads, creates, edits, and confirms real fee records', async () => {
    render(<LogisticsFeePage />)
    expect(await screen.findByText('UAT-TRACK-001')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增费用记录' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增费用记录' }))
    fireEvent.change(dialog.getByLabelText('* 销售平台'), { target: { value: 'Shopify' } })
    fireEvent.change(dialog.getByLabelText('* 店铺'), { target: { value: 'UAT 店铺' } })
    fireEvent.change(dialog.getByLabelText('* 物流渠道'), { target: { value: 'UAT 标准渠道' } })
    fireEvent.change(dialog.getByLabelText('* 订单编号'), { target: { value: 'UAT-FEE-ORDER-001' } })
    fireEvent.change(dialog.getByLabelText('* 物流单号'), { target: { value: 'UAT-TRACK-001' } })
    fireEvent.change(dialog.getByLabelText('* 币种'), { target: { value: 'USD' } })
    fireEvent.change(dialog.getByLabelText('预估费用'), { target: { value: '24' } })
    fireEvent.change(dialog.getByLabelText('实际费用'), { target: { value: '25.4' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(logisticsFeeApi.create).toHaveBeenCalledWith(expect.objectContaining({
      platformName: 'Shopify', shopName: 'UAT 店铺', estimatedFee: 24, actualFee: 25.4, currency: 'USD',
    })))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const editDialog = within(screen.getByRole('dialog', { name: '编辑费用记录' }))
    fireEvent.change(editDialog.getByLabelText('实际费用'), { target: { value: '25.8' } })
    fireEvent.click(editDialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(logisticsFeeApi.update).toHaveBeenCalledWith(record.id, 0, expect.objectContaining({ actualFee: 25.8 })))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(logisticsFeeApi.confirm).toHaveBeenCalledWith(record.id, 0))
  })

  it('requires at least one fee value before submitting', async () => {
    render(<LogisticsFeePage />)
    await screen.findByText('UAT-TRACK-001')
    fireEvent.click(screen.getByRole('button', { name: '新增费用记录' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增费用记录' }))
    fireEvent.change(dialog.getByLabelText('* 销售平台'), { target: { value: 'Shopify' } })
    fireEvent.change(dialog.getByLabelText('* 店铺'), { target: { value: 'UAT 店铺' } })
    fireEvent.change(dialog.getByLabelText('* 物流渠道'), { target: { value: 'UAT 标准渠道' } })
    fireEvent.change(dialog.getByLabelText('* 订单编号'), { target: { value: 'UAT-FEE-ORDER-002' } })
    fireEvent.change(dialog.getByLabelText('* 物流单号'), { target: { value: 'UAT-TRACK-002' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('至少填写一项')
    expect(logisticsFeeApi.create).not.toHaveBeenCalled()
  })

  it('uses an in-app confirmation dialog before archiving', async () => {
    render(<LogisticsFeePage />)
    await screen.findByText('UAT-TRACK-001')

    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    const dialog = within(screen.getByRole('alertdialog', { name: '归档费用记录' }))
    expect(dialog.getByText('UAT-TRACK-001')).toBeTruthy()
    expect(logisticsFeeApi.archive).not.toHaveBeenCalled()

    fireEvent.click(dialog.getByRole('button', { name: '确认归档' }))
    await waitFor(() => expect(logisticsFeeApi.archive).toHaveBeenCalledWith(record.id, 0))
  })
})
