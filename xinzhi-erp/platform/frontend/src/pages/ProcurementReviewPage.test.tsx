import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcurementReviewPage, parseProcurementReviewQuery, toProcurementReviewUrl } from './ProcurementReviewPage'

const state = vi.hoisted(() => ({
  search: '',
  history: { push: vi.fn() },
  list: vi.fn(),
  review: vi.fn(),
  canWrite: true,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: state.history }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: { searchStr: state.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'procurement.write' && state.canWrite }),
}))
vi.mock('../modules/procurementOrderApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementOrderApi')>()
  return { ...actual, procurementOrderApi: { ...actual.procurementOrderApi, list: state.list, review: state.review } }
})

const order = {
  purchaseOrderId: '11111111-1111-4111-8111-111111111111',
  purchaseNo: 'PO-UAT-0001',
  status: 'NEW_ORDER' as const,
  planId: '22222222-2222-4222-8222-222222222222',
  planNo: 'PP-UAT-0001',
  supplierId: '33333333-3333-4333-8333-333333333333',
  supplierCode: 'SUP-UAT',
  supplierName: '测试供应商',
  skuId: '44444444-4444-4444-8444-444444444444',
  skuCode: 'SKU-UAT',
  skuName: '测试商品',
  warehouseId: '55555555-5555-4555-8555-555555555555',
  warehouseCode: 'WH-UAT',
  warehouseName: '测试仓',
  locationId: '66666666-6666-4666-8666-666666666666',
  locationCode: 'A-01',
  locationName: '测试库位',
  quantity: 12,
  receivedQuantity: 0,
  orderedByDisplayName: '采购员甲',
  version: 0,
  createdAt: '2026-08-09T01:00:00Z',
  updatedAt: '2026-08-09T01:00:00Z',
}

beforeEach(() => {
  state.search = ''
  state.canWrite = true
  state.history.push.mockReset()
  state.list.mockReset().mockResolvedValue({ items: [order], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  state.review.mockReset().mockResolvedValue({
    ...order,
    status: 'APPROVED',
    reviewDecision: 'APPROVED',
    reviewedByDisplayName: '审核员甲',
    reviewedAt: '2026-08-09T01:10:00Z',
    version: 1,
  })
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('77777777-7777-4777-8777-777777777777')
})
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('procurement review page', () => {
  it('bounds and serializes real review filters', () => {
    expect(parseProcurementReviewQuery(`?searchField=UNKNOWN&keyword=${'A'.repeat(140)}&page=-1&size=500`)).toEqual({
      searchField: 'PURCHASE_NO',
      keyword: 'A'.repeat(120),
      status: 'NEW_ORDER',
      page: 0,
      size: 25,
    })
    expect(toProcurementReviewUrl({ searchField: 'ORDERED_BY', keyword: ' 审核员 A ', status: 'APPROVED' }))
      .toBe('/procurement/reviews?searchField=ORDERED_BY&keyword=%E5%AE%A1%E6%A0%B8%E5%91%98+A&status=APPROVED')
  })

  it('loads pending orders and persists an approval through the API', async () => {
    render(<ProcurementReviewPage />)
    expect(await screen.findByRole('table', { name: '采购审核列表' })).toBeTruthy()
    expect(screen.getByText('PO-UAT-0001')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    fireEvent.change(screen.getByLabelText('审核备注（可选）'), { target: { value: ' 补货审核通过 ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }))
    await waitFor(() => expect(state.review).toHaveBeenCalledWith({
      commandId: '77777777-7777-4777-8777-777777777777',
      purchaseOrderId: order.purchaseOrderId,
      expectedVersion: 0,
      approved: true,
      reviewNote: '补货审核通过',
    }))
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2))
  })

  it('requires a reason before rejecting an order', async () => {
    render(<ProcurementReviewPage />)
    fireEvent.click(await screen.findByRole('button', { name: '驳回' }))
    const dialog = screen.getByRole('dialog', { name: '驳回采购单' })
    const form = dialog.querySelector('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form!)
    expect(screen.getByRole('alert').textContent).toContain('驳回时必须填写原因')
    expect(state.review).not.toHaveBeenCalled()
  })

  it('runs a selected batch approval instead of exposing a disabled shell action', async () => {
    render(<ProcurementReviewPage />)
    fireEvent.click(await screen.findByLabelText('选择采购单 PO-UAT-0001'))
    const batch = screen.getByRole('button', { name: '批量批准' })
    expect(batch).not.toHaveProperty('disabled', true)
    fireEvent.click(batch)
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }))
    await waitFor(() => expect(state.review).toHaveBeenCalledTimes(1))
  })
})
